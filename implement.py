#!/usr/bin/env python3
"""
AIdea Pulse — Autonomous improvement implementer
Reads the next pending idea from the Notion Roadmap DB,
implements it with Claude Sonnet, deploys to Vercel, updates Notion.
"""
import os, json, re, sys, time, subprocess, shutil
from pathlib import Path
from urllib import request, error
from urllib.request import Request

NOTION_KEY    = os.environ.get('NOTION_KEY', '')
ANTHROPIC_KEY = os.environ.get('ANTHROPIC_KEY', '')
VERCEL_TOKEN  = os.environ.get('VERCEL_TOKEN', '')
GITHUB_TOKEN  = os.environ.get('GITHUB_TOKEN', '')

ROADMAP_DB  = '323c8f76-5510-81d4-bc8b-daf349a315a7'
REPO_DIR    = Path.home() / 'projects/aidea-pulse'
LOCK_FILE   = Path('/tmp/aidea-pulse-implementing.lock')

# -----------------------------------------------------------
def notion(method, endpoint, data=None):
    url  = f'https://api.notion.com/v1/{endpoint}'
    body = json.dumps(data).encode() if data else None
    req  = Request(url, data=body, method=method, headers={
        'Authorization':  f'Bearer {NOTION_KEY}',
        'Notion-Version': '2022-06-28',
        'Content-Type':   'application/json'
    })
    try:
        with request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except error.HTTPError as e:
        return json.loads(e.read())

def anthropic(prompt, model='claude-sonnet-4-6', max_tokens=8000):
    url  = 'https://api.anthropic.com/v1/messages'
    body = json.dumps({'model': model, 'max_tokens': max_tokens,
                       'messages': [{'role':'user','content': prompt}]}).encode()
    req  = Request(url, data=body, method='POST', headers={
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
    })
    with request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())['content'][0]['text']

def vercel_deploy():
    url  = 'https://api.vercel.com/v13/deployments'
    body = json.dumps({
        'name': 'aidea-pulse',
        'gitSource': {'type':'github','repoId':1181956459,'ref':'master',
                      'org':'melgarejo-drp','repo':'aidea-pulse'},
        'projectSettings': {'framework': None}
    }).encode()
    req = Request(url, data=body, method='POST', headers={
        'Authorization': f'Bearer {VERCEL_TOKEN}',
        'Content-Type':  'application/json'
    })
    with request.urlopen(req, timeout=30) as r:
        deploy_id = json.loads(r.read()).get('id','')
    if not deploy_id:
        raise RuntimeError('Vercel deploy returned no ID')

    print(f'  deploy {deploy_id} — waiting...')
    for _ in range(24):
        time.sleep(10)
        status_req = Request(f'https://api.vercel.com/v13/deployments/{deploy_id}',
                             headers={'Authorization': f'Bearer {VERCEL_TOKEN}'})
        with request.urlopen(status_req, timeout=15) as r:
            state = json.loads(r.read()).get('readyState','')
        print(f'  state: {state}')
        if state == 'READY':
            # Re-apply alias
            alias_body = json.dumps({'alias':'aidea-pulse.vercel.app'}).encode()
            alias_req  = Request(
                f'https://api.vercel.com/v2/deployments/{deploy_id}/aliases',
                data=alias_body, method='POST',
                headers={'Authorization': f'Bearer {VERCEL_TOKEN}',
                         'Content-Type':  'application/json'})
            request.urlopen(alias_req, timeout=15)
            return deploy_id
        if state in ('ERROR','CANCELED'):
            raise RuntimeError(f'Deploy failed: {state}')
    raise RuntimeError('Deploy timeout after 4 minutes')

# -----------------------------------------------------------
def get_next():
    res = notion('POST', f'databases/{ROADMAP_DB}/query', {
        'filter': {'property':'Estado','select':{'equals':'💡 Pendiente'}},
        'sorts':  [{'property':'Orden','direction':'ascending'}],
        'page_size': 1
    })
    if not res.get('results'):
        return None
    p    = res['results'][0]
    prop = p['properties']
    return {
        'id':     p['id'],
        'nombre': (prop['Nombre']['title'] or [{}])[0].get('text',{}).get('content',''),
        'desc':   (prop['Descripción']['rich_text'] or [{}])[0].get('text',{}).get('content',''),
        'notas':  (prop['Notas técnicas']['rich_text'] or [{}])[0].get('text',{}).get('content','')
    }

def update_status(page_id, status, notes=''):
    data = {'properties': {
        'Estado': {'select':{'name': status}},
        'Notas de implementación': {'rich_text':[{'text':{'content': notes[:2000]}}]}
    }}
    if status == '✅ Implementada':
        data['properties']['Implementado en'] = {
            'date': {'start': time.strftime('%Y-%m-%dT%H:%M:%S-05:00')}
        }
    notion('PATCH', f'pages/{page_id}', data)

def read_repo_files():
    files = {}
    for f in ['index.html','api/brief.js','api/history.js','api/today.js']:
        p = REPO_DIR / f
        if p.exists():
            content = p.read_text()
            # Truncate large files — index.html is big, keep key sections
            limit = 4000
            files[f] = content[:limit] + (f'\n... [truncated at {limit} chars]' if len(content) > limit else '')
    return files

def implement_with_claude(improvement, files):
    ctx = '\n\n'.join(f'### {k}\n```\n{v}\n```' for k, v in files.items())
    prompt = f"""Eres un ingeniero implementando una mejora para AIdea Pulse — una app web deployada en Vercel.
Stack: HTML/CSS/JS vanilla (index.html), Vercel Serverless Functions (api/*.js en ES modules, export default handler).

## Mejora
Nombre: {improvement['nombre']}
Descripción: {improvement['desc']}
Notas técnicas: {improvement['notas']}

## Código actual
{ctx}

## Tu tarea
Implementa la mejora de forma completa y production-ready.

Responde ÚNICAMENTE con JSON válido, sin texto antes ni después, sin bloques de código markdown:
{{
  "files_to_modify": {{ "filename": "full file content" }},
  "files_to_create": {{ "filename": "full file content" }},
  "summary": "1-2 líneas de qué se implementó"
}}

Reglas:
- Solo modifica lo estrictamente necesario; no romper funcionalidad existente
- Si solo cambia el frontend, solo modifica index.html
- Los archivos api/*.js deben usar ES modules (export default) y fetch nativo
- El código debe funcionar sin npm install (no hay build step)
- No incluyas nada fuera del JSON"""

    raw = anthropic(prompt, max_tokens=12000)
    # Try to find JSON block
    m = re.search(r'\{[\s\S]*\}', raw)
    if not m:
        raise ValueError(f'No JSON in Claude response. Got: {raw[:200]}')
    json_str = m.group(0)
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        # Response was truncated — ask Claude to complete it
        print(f'  JSON truncated, requesting completion...')
        completion = anthropic(
            f'This JSON was cut off. Complete it so it is valid JSON. Return ONLY the complete JSON:\n{json_str}',
            max_tokens=8000
        )
        m2 = re.search(r'\{[\s\S]*\}', completion)
        if not m2:
            raise ValueError(f'Still no valid JSON after completion attempt: {e}')
        return json.loads(m2.group(0))

def backup_files(filenames):
    for f in filenames:
        src = REPO_DIR / f
        if src.exists():
            shutil.copy2(src, str(src) + '.bak')

def restore_backups(filenames):
    for f in filenames:
        bak = Path(str(REPO_DIR / f) + '.bak')
        if bak.exists():
            shutil.copy2(bak, REPO_DIR / f)
            bak.unlink()

def apply_files(changes):
    all_files = {**changes.get('files_to_modify',{}), **changes.get('files_to_create',{})}
    for fname, content in all_files.items():
        p = REPO_DIR / fname
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)

def git_push(message):
    env = {**os.environ,
           'GIT_AUTHOR_NAME': 'Limoncito',
           'GIT_AUTHOR_EMAIL': 'melgarejorodriguez19@gmail.com',
           'GIT_COMMITTER_NAME': 'Limoncito',
           'GIT_COMMITTER_EMAIL': 'melgarejorodriguez19@gmail.com'}
    subprocess.run(['git','add','-A'], cwd=REPO_DIR, check=True, env=env)
    # Check if there's anything to commit
    result = subprocess.run(['git','diff','--cached','--quiet'], cwd=REPO_DIR, env=env)
    if result.returncode == 0:
        raise ValueError('No changes to commit — Claude may have returned unchanged files')
    subprocess.run(['git','commit','-m', message], cwd=REPO_DIR, check=True, env=env)

    push_url = f'https://melgarejo-drp:{GITHUB_TOKEN}@github.com/melgarejo-drp/aidea-pulse.git'
    result = subprocess.run(['git','push', push_url, 'master'],
                            cwd=REPO_DIR, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise RuntimeError(f'Push failed: {result.stderr[:300]}')

# -----------------------------------------------------------
def main():
    if LOCK_FILE.exists():
        print('LOCKED — another implementation in progress')
        sys.exit(0)

    improvement = get_next()
    if not improvement:
        print('NO_PENDING')
        sys.exit(0)

    print(f'Implementing: {improvement["nombre"]}')
    LOCK_FILE.touch()
    update_status(improvement['id'], '🔨 En progreso')

    files_modified = []
    try:
        files   = read_repo_files()
        changes = implement_with_claude(improvement, files)
        summary = changes.get('summary','')

        all_modified = list(changes.get('files_to_modify',{}).keys())
        backup_files(all_modified)
        files_modified = all_modified

        apply_files(changes)
        git_push(f'feat: {improvement["nombre"]} (auto by Limoncito 🍋)')
        vercel_deploy()

        update_status(improvement['id'], '✅ Implementada', summary)
        print(f'SUCCESS: {summary}')

    except Exception as e:
        print(f'ERROR: {e}')
        if files_modified:
            restore_backups(files_modified)
        update_status(improvement['id'], '❌ Error', str(e)[:500])
        sys.exit(1)

    finally:
        LOCK_FILE.unlink(missing_ok=True)

if __name__ == '__main__':
    main()
