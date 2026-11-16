from pathlib import Path
from datetime import datetime
import subprocess, tempfile, shutil, sys

root = Path.home() / 'agent-risk-layer'
if not (root / '.git').exists():
    raise SystemExit('STOP: impossible de confirmer le dépôt ENKYRON.')
base = '3aad929672d20f1c4c034d46d879f089eab86ef2'
new = '6acfc60d19755593dee2e71fc5a6241d262e6842'
existing = [
    'desktop/enkyron-bridge.mjs',
    'desktop/enkyron-crm-mail-drafts.mjs',
    'desktop/enkyron-mail-local.mjs',
    'desktop/enkyron-mail-service.mjs',
    'desktop/enkyron.py',
    'desktop/enkyron_mail_workspace.py',
]
added = [
    'desktop/enkyron-mail-record-filing.mjs',
    'migrations/116_enkyron_mail_record_filing.sql',
    'scripts/enkyron-mail-record-filing-schema.mjs',
    'tests/enkyron-mail-record-filing.test.js',
    'tests/qt_enkyron_mail_folder_smoke.py',
]

def cmd(args, **kw):
    return subprocess.run(args, cwd=root, text=True, capture_output=True, **kw)

for sha in (base, new):
    present = cmd(['git','cat-file','-e',sha+'^{commit}'])
    if present.returncode:
        r = cmd(['git','fetch','--no-tags','origin',sha])
        if r.returncode:
            raise SystemExit('STOP: accès GitHub impossible : '+r.stderr.strip()[:300])

def source(sha, name):
    r = cmd(['git','show',f'{sha}:{name}'])
    if r.returncode:
        raise RuntimeError('Référence distante indisponible : '+name)
    return r.stdout

def sql_patch(name, ours):
    if name.endswith('enkyron-crm-mail-drafts.mjs'):
        join = "      +'LEFT JOIN enkyron_mail_record_filing f ON f.workspace_key=d.workspace_key AND f.draft_id=d.id '\n"
        anchor = "      +'FROM enkyron_crm_mail_drafts d '\n"
        if join not in ours:
            if ours.count(anchor)!=1: raise RuntimeError('Draft list join changed')
            ours=ours.replace(anchor,anchor+join,1)
        old = "AND a.id IS NULL AND s.id IS NULL "
        new = "AND a.id IS NULL AND s.id IS NULL AND COALESCE(f.folder_key,'drafts')='drafts' "
        if new not in ours:
            if ours.count(old)!=1: raise RuntimeError('Draft list filter changed')
            ours=ours.replace(old,new,1)
        return ours
    if name.endswith('enkyron-mail-service.mjs'):
        start=ours.find('export async function mailSent(')
        end=ours.find('export function ',start+10)
        if start<0: raise RuntimeError('Sent query missing')
        if end<0:end=len(ours)
        section=ours[start:end]
        join = "    'LEFT JOIN enkyron_mail_record_filing f '+\n    'ON f.workspace_key=d.workspace_key AND f.draft_id=d.id '+\n"
        anchor = "    'ON co.workspace_key=d.workspace_key AND co.id=d.company_id '+\n"
        if join not in section:
            if section.count(anchor)!=1: raise RuntimeError('Sent query join changed')
            section=section.replace(anchor,anchor+join,1)
        old = "    'WHERE s.workspace_key=$1 ORDER BY s.recorded_at DESC LIMIT 100',"
        new = ("    \"WHERE s.workspace_key=$1 AND COALESCE(f.folder_key,'sent')='sent' \"+\n"
               "    'ORDER BY s.recorded_at DESC LIMIT 100',")
        if "COALESCE(f.folder_key,'sent')='sent'" not in section:
            if section.count(old)!=1: raise RuntimeError('Sent query filter changed')
            section=section.replace(old,new,1)
        return ours[:start]+section+ours[end:]
    raise RuntimeError('No safe SQL merge adapter')

def bridge_patch(src):
    import_stmt = "import {moveSavedMailRecord,listFiledSavedMail,clearTrashedLocalMail,validateRecordMove} from './enkyron-mail-record-filing.mjs';"
    if import_stmt not in src:
        marker = "import {archiveNextMailBatch,mailArchiveStatus,readArchivedFullText} from './enkyron-mail-archive.mjs';"
        if src.count(marker) != 1: raise RuntimeError('Bridge import anchor absent')
        src = src.replace(marker, marker + '\n' + import_stmt)
    parts = src.splitlines(keepends=True)
    for i, line in enumerate(parts):
        additions = None
        if line.startswith('  if (![') and '.includes(command)' in line:
            additions = "'mail-record-move', 'mail-filed-records', 'mail-trash-clear', "
        elif line.startswith('  const payload = [') and '.includes(command)' in line:
            additions = "'mail-record-move', 'mail-filed-records', 'mail-trash-clear', "
        elif line.startswith('  const readOnly = ![') and '.includes(command)' in line:
            additions = "'mail-record-move', 'mail-trash-clear', "
        if additions and "'mail-record-move'" not in line:
            if "'mail-local-move', " not in line: raise RuntimeError('Bridge command gate anchor absent')
            parts[i] = line.replace("'mail-local-move', ", "'mail-local-move', " + additions, 1)
    src = ''.join(parts)
    validation = "  if (command === 'mail-record-move') validateRecordMove(payload);\n"
    if validation not in src:
        anchor = "  if (command === 'crm-mail-update') validateDraftUpdate(payload);\n"
        if src.count(anchor) != 1: raise RuntimeError('Bridge validation anchor absent')
        src = src.replace(anchor,anchor+validation,1)
    dispatch = """      command === 'mail-record-move' ? await moveSavedMailRecord(pool,os.userInfo().username,payload) :
      command === 'mail-filed-records' ? await listFiledSavedMail(pool,os.userInfo().username,payload) :
      command === 'mail-trash-clear' ? await clearTrashedLocalMail(pool,os.userInfo().username,payload) :
"""
    if dispatch not in src:
        lines = src.splitlines(keepends=True)
        matches = [i for i,x in enumerate(lines) if "command === 'mail-local-move' ?" in x]
        if len(matches) != 1: raise RuntimeError('Bridge route anchor absent')
        lines.insert(matches[0]+1,dispatch)
        src=''.join(lines)
    for token in ('mail-record-move','mail-filed-records','mail-trash-clear'):
        if src.count(token)<3: raise RuntimeError('Bridge route incomplete: '+token)
    return src

merges = {}; originals = {}; problems = []
for name in existing:
    path = root / name
    if not path.is_file():
        problems.append(name+' (fichier local absent)'); continue
    ours = path.read_text()
    originals[name] = ours
    if name == 'desktop/enkyron-bridge.mjs':
        try: merges[name] = bridge_patch(ours)
        except RuntimeError as exc: problems.append(name+' ('+str(exc)+')')
        continue
    normalized = ours
    if name.endswith('enkyron_mail_workspace.py'):
        normalized = normalized.replace(
            'if key in ("sent", "drafts", actual_folder):',
            'if key in ("sent","drafts",self._folder):')
    with tempfile.TemporaryDirectory(prefix='enkyron-merge-') as td:
        files = [Path(td)/n for n in ('ours','base','theirs')]
        for dest, value in zip(files, (normalized,source(base,name),source(new,name))):
            dest.write_text(value)
        r = subprocess.run(['git','merge-file','-p',*[str(x) for x in files]],capture_output=True,text=True)
    if r.returncode != 0:
        try:
            if name in ('desktop/enkyron-crm-mail-drafts.mjs','desktop/enkyron-mail-service.mjs'):
                merges[name]=sql_patch(name,ours)
                continue
        except RuntimeError: pass
        problems.append(name+' (conflit avec ton code local)'); continue
    merged = r.stdout
    if name.endswith('enkyron_mail_workspace.py') and normalized != ours:
        merged = merged.replace(
            'if key in ("sent", "drafts", self._folder, "hidden"):',
            'if key in ("sent", "drafts", actual_folder, "hidden"):')
        if 'if key in ("sent", "drafts", actual_folder, "hidden"):' not in merged:
            problems.append(name+' (adaptation du dossier non confirmée)');continue
    merges[name] = merged

for name in added:
    path=root/name
    value=source(new,name)
    if path.exists() and path.read_text() != value:
        problems.append(name+' (fichier local différent)')
    else:
        merges[name]=value

if problems:
    print('STOP SANS MODIFICATION :')
    for item in problems: print(' -',item)
    print('Les données et les fichiers locaux sont intacts.')
    sys.exit(1)

for name, value in merges.items():
    if name.endswith('.py'):
        compile(value, name, 'exec')
    if name.endswith('.mjs'):
        with tempfile.TemporaryDirectory(prefix='enkyron-verify-') as td:
            scratch=Path(td)/'check.mjs';scratch.write_text(value)
            r=subprocess.run(['node','--check',str(scratch)],capture_output=True,text=True)
            if r.returncode:
                raise SystemExit('STOP: vérification syntaxique échouée : '+name+'\n'+r.stderr[:300])

backup = root/'data'/'backups'/('enkyron-mail-610-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
backup.mkdir(parents=True, mode=0o700, exist_ok=False)
changed=[]
try:
    for name, value in merges.items():
        path=root/name
        if path.exists():
            if name in originals and path.read_text()!=originals[name]:
                raise RuntimeError(name+' a changé pendant la préparation')
            dest=backup/name;dest.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(path,dest)
        else:
            path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(value)
        changed.append(name)
    r=cmd(['node','--test','tests/enkyron-mail-record-filing.test.js'])
    if r.returncode:
        raise RuntimeError('Test Node échoué : '+(r.stdout+r.stderr)[-900:])
except Exception as exc:
    for name in reversed(changed):
        previous=backup/name
        if previous.exists(): shutil.copy2(previous,root/name)
        else: (root/name).unlink(missing_ok=True)
    raise SystemExit('INSTALLATION ANNULÉE, fichiers restaurés : '+str(exc))
print('OK : code de déplacement Sent/Drafts intégré. Tests Node OK.')
print('Sauvegardes :',backup)
print('Aucune donnée mail ni base PostgreSQL modifiée.')
print('Étape suivante : vérifier puis appliquer la migration avec sauvegarde.')
