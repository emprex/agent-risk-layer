"""ENKYRON outbound mail files; durable across draft reopening."""
import hashlib, json, os, re, stat, uuid
from pathlib import Path

FORMATS = {'.pdf','.png','.jpg','.jpeg','.gif','.webp','.txt','.md',
 '.csv','.json','.xml','.doc','.docx','.xls','.xlsx','.ppt','.pptx',
 '.odt','.ods','.odp','.zip'}
KEY = re.compile(r'^(new-[a-f0-9]{32}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$', re.I)
MAX_TOTAL = 12 * 1024 * 1024

def _m05_outgoing_folder(key):
    if not isinstance(key,str) or not KEY.fullmatch(key):
        raise ValueError('Invalid draft identifier')
    return Path(os.environ.get('XDG_DATA_HOME') or Path.home()/'.local/share')/'enkyron/outgoing-attachments'/key

def list_outgoing(key):
    folder = _m05_outgoing_folder(key)
    manifest = folder/'manifest.json'
    if not manifest.exists(): return []
    if folder.is_symlink() or manifest.is_symlink():
        raise ValueError('Unsafe attachment storage')
    data = json.loads(manifest.read_text(encoding='utf-8'))
    items = data.get('files') if isinstance(data,dict) else None
    if not isinstance(items,list) or len(items)>8:
        raise ValueError('Invalid attachment manifest')
    return items

def _write(key, items):
    folder = _m05_outgoing_folder(key)
    if folder.is_symlink():
        raise ValueError('Unsafe attachment folder')
    folder.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.chmod(folder,0o700)
    tmp = folder/('manifest.'+uuid.uuid4().hex+'.tmp')
    try:
        fd = os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w',encoding='utf-8') as f:
            json.dump({'files':items},f,ensure_ascii=False)
        tmp.replace(folder/'manifest.json')
    finally:
        tmp.unlink(missing_ok=True)

def add_outgoing(key, paths):
    items = list_outgoing(key)
    if len(items)+len(paths)>8:
        raise ValueError('Maximum 8 files per email')
    total = sum(int(x['size']) for x in items)
    pending=[]
    for name in paths:
        source = Path(name)
        info = source.lstat()
        if not stat.S_ISREG(info.st_mode) or source.is_symlink():
            raise ValueError('Select a regular file')
        if source.suffix.lower() not in FORMATS or len(source.name)>160:
            raise ValueError('Unsupported file type or name: '+source.name[:80])
        if any(ord(c)<32 for c in source.name):
            raise ValueError('Unsafe filename')
        if not 0<info.st_size<=10*1024*1024 or total+info.st_size>MAX_TOTAL:
            raise ValueError('Maximum 10 MB per file / 12 MB combined')
        content = source.read_bytes()
        if len(content)!=info.st_size:
            raise ValueError('File changed during selection')
        pending.append((uuid.uuid4().hex,source.name,content))
        total += len(content)

    folder = _m05_outgoing_folder(key)
    if pending:
        folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        os.chmod(folder,0o700)

    created=[]
    try:
        for ident,name,content in pending:
            file = folder/(ident+'.blob')
            fd = os.open(file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            created.append(file)
            with os.fdopen(fd,'wb') as f:
                f.write(content)
            items.append({
                'id':ident,'filename':name,'size':len(content),
                'sha256':hashlib.sha256(content).hexdigest()
            })
        if pending:
            _write(key,items)
    except Exception:
        for file in created:
            file.unlink(missing_ok=True)
        raise
    return items

def remove_outgoing(key,index):
    items=list_outgoing(key)
    if not isinstance(index,int) or index<0 or index>=len(items):
        raise ValueError('File not found')
    record=items.pop(index)
    _write(key,items)
    (_m05_outgoing_folder(key)/(record['id']+'.blob')).unlink(
        missing_ok=True
    )
    return items

def bind_outgoing(key,draft_id):
    if key==draft_id:
        return draft_id
    source=_m05_outgoing_folder(key)
    dest=_m05_outgoing_folder(draft_id)
    if not source.exists():
        return draft_id
    if source.is_symlink() or dest.exists():
        raise ValueError('Attachment destination already exists')
    source.rename(dest)
    return draft_id

def discard_new_outgoing(key):
    if isinstance(key,str) and key.startswith('new-'):
        folder=_m05_outgoing_folder(key)
        if folder.exists() and not folder.is_symlink():
            import shutil
            shutil.rmtree(folder)
