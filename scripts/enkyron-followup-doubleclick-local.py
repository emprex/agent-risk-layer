#!/usr/bin/env python3
"""ENKYRON: open exact opportunity on row double-click in Home and CRM Follow-ups.
Local, guarded Python-only UI correction. No database migrations, no Git checkout.
"""
from pathlib import Path
from datetime import datetime
import os
import shutil
import stat
import tempfile
import sys

file = Path.home() / "agent-risk-layer/desktop/enkyron.py"
if not file.is_file() or file.is_symlink():
    sys.exit("STOP : desktop/enkyron.py introuvable ou non sécurisé.")
original = file.read_text(encoding="utf-8")
if "def open_home_followup_double_click(" in original:
    print("Déjà installé : le double-clic Home / CRM existe.")
    sys.exit(0)

def exact_replace(content, before, after, purpose):
    n = content.count(before)
    if n != 1:
        raise ValueError(f"{purpose} : structure locale différente ({n} correspondances).")
    return content.replace(before, after, 1)

try:
    patched = exact_replace(
        original,
        '''        self.sales_overview_table.setVisible(False)
        home_l.addWidget(self.sales_overview_table, 10)
''',
        '''        self.sales_overview_table.setVisible(False)
        self.sales_overview_table.setToolTip(
            "Double-click a follow-up to open its exact commercial opportunity.")
        self.sales_overview_table.cellDoubleClicked.connect(
            self.open_home_followup_double_click)
        home_l.addWidget(self.sales_overview_table, 10)
''',
        "Connecter double-clic Home")
    patched = exact_replace(
        patched,
        '''        self.crm_followup_table.itemSelectionChanged.connect(
            self.followup_selected
        )
''',
        '''        self.crm_followup_table.itemSelectionChanged.connect(
            self.followup_selected
        )
        self.crm_followup_table.setToolTip(
            "Double-click a follow-up to update the selected opportunity.")
        self.crm_followup_table.cellDoubleClicked.connect(
            self.open_crm_followup_double_click)
''',
        "Connecter double-clic Follow-ups")

    block_start = patched.find("\n    def load_sales_overview(self):")
    block_end = patched.find("\n    def open_sales_followups(self):",block_start+1)
    if block_start < 0 or block_end < 0:
        raise ValueError("Fonction Home introuvable.")
    home = patched[block_start:block_end]
    home = exact_replace(
        home,
        '''                for column, value in enumerate(values):
                    self.sales_overview_table.setItem(
                        row, column, QTableWidgetItem(str(value))
                    )
''',
        '''                for column, value in enumerate(values):
                    cell = QTableWidgetItem(str(value))
                    if column == 0:
                        # Bind the exact opportunity ID, never infer it by name.
                        cell.setData(Qt.ItemDataRole.UserRole, item.get("id"))
                    self.sales_overview_table.setItem(row, column, cell)
''',
        "Conserver identifiant exact dans Home")
    patched = patched[:block_start] + home + patched[block_end:]

    methods = '''    def open_home_followup_double_click(self, row, _column):
        """Open the clicked opportunity by exact ID using a fresh scoped read."""
        if not 0 <= row < self.sales_overview_table.rowCount():
            return
        cell = self.sales_overview_table.item(row, 0)
        if cell is None:
            return
        opportunity_id = cell.data(Qt.ItemDataRole.UserRole)
        if not isinstance(opportunity_id, str) or not opportunity_id:
            return
        if self.crm_followup_dialog and self.crm_followup_dialog.isVisible():
            self.crm_followup_dialog.raise_()
            return

        # Company text narrows the read; its result is NEVER treated as identity.
        # If the exact ID is missing from the bounded result, fail closed.
        search = cell.text().strip()[:100]
        def received(data, error):
            if self.crm_followup_dialog and self.crm_followup_dialog.isVisible():
                self.crm_followup_dialog.raise_()
                return
            if error or not isinstance(data, dict) or data.get("available") is False:
                QMessageBox.warning(
                    self, "Follow-up unavailable",
                    str(error or "Refresh the CRM opportunity list.")[:350])
                return
            entries = data.get("items")
            if not isinstance(entries, list):
                QMessageBox.warning(self, "Follow-up unavailable",
                                    "Invalid CRM response; no changes made.")
                return
            matches = [
                entry for entry in entries
                if isinstance(entry, dict) and entry.get("id") == opportunity_id
            ]
            if (len(matches) != 1
                    or not isinstance(matches[0].get("version"), int)):
                QMessageBox.warning(
                    self, "Refresh this opportunity",
                    "The exact follow-up could not be verified. "
                    "Open CRM > Follow-ups and refresh; no changes were made.")
                return
            current = dict(matches[0])
            self.build_followup_dialog({
                "id": current.get("prospect_id"),
                "company_name": current.get("company_name_at_creation") or ""
            }, current)

        self.bridge.call("crm-opportunities", search, callback=received)

    def open_crm_followup_double_click(self, row, _column):
        """Reuse the existing versioned follow-up editor for the clicked row."""
        if not 0 <= row < len(self.crm_followup_items):
            return
        self.crm_followup_table.selectRow(row)
        self.open_followup_update()

'''
    patched = exact_replace(
        patched,
        "    def open_sales_followups(self):\n",
        methods + "    def open_sales_followups(self):\n",
        "Insérer les deux actions double-clic")

    compile(patched, str(file), "exec")
    for required in (
        "self.open_home_followup_double_click",
        "self.open_crm_followup_double_click",
        "cell.setData(Qt.ItemDataRole.UserRole, item.get(\"id\"))",
        'entry.get("id") == opportunity_id',
        'self.bridge.call("crm-opportunities", search, callback=received)',
        "self.open_followup_update()",
    ):
        if required not in patched:
            raise ValueError("Vérification incomplète : " + required)
    if original == patched:
        raise ValueError("Aucune modification détectée.")

    backups = Path.home()/".local/share/enkyron/source-backups"
    backups.mkdir(parents=True, exist_ok=True,mode=0o700)
    backup = backups/("enkyron-followup-doubleclick-"+
                      datetime.now().strftime("%Y%m%d-%H%M%S-%f")+".py")
    if file.read_text(encoding="utf-8") != original:
        raise ValueError("ENKYRON a changé depuis la vérification.")
    shutil.copy2(file, backup)
    fd, tmp = tempfile.mkstemp(prefix=".enkyron-followup-",suffix=".tmp",dir=file.parent)
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as handle:
            handle.write(patched)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, stat.S_IMODE(file.stat().st_mode))
        if file.read_text(encoding="utf-8") != original:
            raise ValueError("ENKYRON modifié pendant la sauvegarde.")
        os.replace(tmp,file)
    finally:
        Path(tmp).unlink(missing_ok=True)
except Exception as exc:
    sys.exit("STOP SANS INSTALLATION : "+str(exc))

print("OK : double-clic Home et CRM Follow-ups installé.")
print("La fiche est retrouvée par l'identifiant exact, sans envoi de mail.")
print("Syntaxe Python vérifiée ; aucune modification PostgreSQL.")
print("Sauvegarde : "+str(backup))
print("Relance ENKYRON et double-clique sur Xurrent dans Home ou Follow-ups.")
