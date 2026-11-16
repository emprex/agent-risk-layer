#!/usr/bin/env python3
"""Make Company 360 sector use the same controlled selector as Register Company.
Targets exactly the dossier editor; no database, mail, CRM or Git operations.
"""
from pathlib import Path
from datetime import datetime
import os
import shutil
import stat
import tempfile
import sys

path = Path.home() / "agent-risk-layer/desktop/enkyron.py"
if not path.is_file() or path.is_symlink():
    raise SystemExit("STOP: fichier ENKYRON absent ou non sécurisé.")
original = path.read_text(encoding="utf-8")
begin = original.find("\n    def open_dossier_company_editor(self):")
end = original.find("\n    def company_dossier_pending_or_unsaved(self):", begin + 1)
if begin < 0 or end <= begin:
    raise SystemExit("STOP: structure de l'éditeur Company 360 inconnue.")
section = original[begin:end]
if 'control = crm_sector_selector(str(company.get(key) or ""))' in section:
    print("OK: secteur Company 360 déjà géré par le menu déroulant.")
    raise SystemExit(0)
if "def crm_sector_selector(current=" not in original or "CRM_SECTORS = (" not in original:
    raise SystemExit("STOP: liste des secteurs standard absente.")

def swap(old, new, label):
    global section
    if section.count(old) != 1:
        raise SystemExit("STOP: code local différent (" + label + "). Aucun changement.")
    section = section.replace(old, new, 1)

swap(
    '''        for key, label, limit in fields:
            control = QLineEdit()
            control.setObjectName("crmDossierCompany_" + key)
            control.setMaxLength(limit)
            control.setText(str(company.get(key) or ""))
            form.addRow(label, control)
            inputs[key] = control
            initial[key] = control.text()
''',
    '''        for key, label, limit in fields:
            if key == "sector":
                control = crm_sector_selector(str(company.get(key) or ""))
            else:
                control = QLineEdit()
                control.setMaxLength(limit)
                control.setText(str(company.get(key) or ""))
            control.setObjectName("crmDossierCompany_" + key)
            form.addRow(label, control)
            inputs[key] = control
            initial[key] = (control.currentText()
                            if isinstance(control, QComboBox) else control.text())
''',
    "sélecteur du secteur"
)
swap(
    '''        def refresh_save(*_unused):
            note = rationale.toPlainText().strip()
            vals = [field.text() for field in inputs.values()]
            changed = {
                key for key, field in inputs.items()
                if field.text() != initial[key]
            }
''',
    '''        def field_value(field):
            return field.currentText() if isinstance(field, QComboBox) else field.text()

        def refresh_save(*_unused):
            note = rationale.toPlainText().strip()
            vals = [field_value(field) for field in inputs.values()]
            changed = {
                key for key, field in inputs.items()
                if field_value(field) != initial[key]
            }
''',
    "détection des changements"
)
swap(
    '                **{key: widget.text() for key, widget in inputs.items()}\n',
    '                **{key: field_value(widget) for key, widget in inputs.items()}\n',
    "sauvegarde des champs"
)
swap(
    '''        for field in inputs.values():
            field.textChanged.connect(refresh_save)
''',
    '''        for field in inputs.values():
            (field.currentTextChanged if isinstance(field, QComboBox)
             else field.textChanged).connect(refresh_save)
''',
    "événement de modification"
)

revised = original[:begin] + section + original[end:]
compile(revised, str(path), "exec")
assert 'control = crm_sector_selector(str(company.get(key) or ""))' in section
assert 'if field_value(field) != initial[key]' in section
assert 'key: field_value(widget)' in section
assert 'field.currentTextChanged if isinstance(field, QComboBox)' in section

backup_dir = Path.home() / ".local/share/enkyron/source-backups"
backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
backup = backup_dir / ("enkyron-sector-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".py")
if path.read_text(encoding="utf-8") != original:
    raise SystemExit("STOP: le fichier a changé pendant la préparation.")
shutil.copy2(path, backup)
fd, tmp_name = tempfile.mkstemp(prefix=".enkyron-sector-", suffix=".tmp", dir=path.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(revised)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(tmp_name, stat.S_IMODE(path.stat().st_mode))
    if path.read_text(encoding="utf-8") != original:
        raise RuntimeError("ENKYRON a été modifié pendant la correction.")
    os.replace(tmp_name, path)
except Exception as exc:
    Path(tmp_name).unlink(missing_ok=True)
    raise SystemExit("STOP: aucun remplacement validé: " + str(exc))

print("OK: Company 360 utilise le même menu Sector que Register Company.")
print("Syntaxe Python vérifiée. Aucun changement PostgreSQL ou email.")
print("Sauvegarde:", backup)
print("Relance ENKYRON, rouvre Enginy puis Edit company details.")
