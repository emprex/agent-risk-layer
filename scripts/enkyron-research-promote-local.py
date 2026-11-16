#!/usr/bin/env python3
"""Safe, narrowly scoped ENKYRON Research -> CRM promotion upgrade.
No git checkout/reset, no database writes, no automatic outreach.
"""
from datetime import datetime
from pathlib import Path
import subprocess
import tempfile
import shutil
import sys
import re

ROOT = Path.home() / "agent-risk-layer"
PATHS = (
    "desktop/enkyron.py",
    "desktop/enkyron-crm-prospects.mjs",
    "desktop/enkyron-bridge.mjs",
    "tests/enkyron-crm-prospects.test.js",
)

def replace_once(s, old, new, description):
    if s.count(old) != 1:
        raise ValueError("Conflit local: " + description + " (aucune modification)")
    return s.replace(old, new, 1)

def py_upgrade(s):
    if "def open_research_company_from_table(" in s:
        raise ValueError("La fonctionnalité semble déjà présente; aucune réinstallation.")
    s = replace_once(s,
        "        self.crm_table.itemSelectionChanged.connect(self.show_prospect)\n",
        "        self.crm_table.itemSelectionChanged.connect(self.show_prospect)\n"
        "        self.crm_table.cellDoubleClicked.connect(self.open_research_company_from_table)\n",
        "double-clic dans Research")
    s = replace_once(s,
        "        self.crm_review_button = QPushButton(\"Review for CRM association…\")",
        "        self.crm_review_button = QPushButton(\"Create company from research…\")",
        "bouton de création")
    function = (
        "    def open_research_company_from_table(self, row, _column):\n"
        "        \"\"\"Open the existing audited company-creation review on double-click.\"\"\"\n"
        "        if 0 <= row < len(self.crm_items):\n"
        "            candidate = self.crm_items[row]\n"
        "            if isinstance(candidate, dict) and candidate.get(\"id\"):\n"
        "                self.open_prospect_review_for_id(candidate[\"id\"])\n\n"
    )
    s = replace_once(s, "    def open_prospect_review(self):\n",
                     function + "    def open_prospect_review(self):\n",
                     "action double-clic")
    s = replace_once(s,
        "            dialog.setWindowTitle(\"ENKYRON · Review historical prospect\")",
        "            dialog.setWindowTitle(\"ENKYRON · Create company from research\")",
        "titre fenêtre")
    s = replace_once(s,
        "            layout.addWidget(section_title(\"MANUAL PROSPECT → COMPANY ASSOCIATION\"))",
        "            layout.addWidget(section_title(\"CREATE / LINK COMPANY FROM RESEARCH\"))",
        "titre création CRM")
    s = replace_once(s,
        "            form = QFormLayout()\n            self.crm_review_choice = QComboBox()\n",
        "            form = QFormLayout()\n"
        "            candidate_name = QLineEdit(str(source.get(\"company_name\") or \"\"))\n"
        "            candidate_name.setReadOnly(True)\n"
        "            candidate_website = QLineEdit(str(source.get(\"website\") or \"\"))\n"
        "            candidate_website.setReadOnly(True)\n"
        "            form.addRow(\"Company name\", candidate_name)\n"
        "            form.addRow(\"Website\", candidate_website)\n"
        "            self.crm_review_choice = QComboBox()\n",
        "champs source de la nouvelle entreprise")
    s = replace_once(s,
        "                    \"Create a new prospect company (no apparent match)\",",
        "                    \"Create company in Companies & Contacts\",",
        "option créer entreprise")
    s = replace_once(s,
        "            self.crm_review_submit = QPushButton(\"Record association\")",
        "            self.crm_review_submit = QPushButton(\"Save company to CRM\")",
        "bouton enregistrer")
    s = replace_once(s,
        '            "Save this ONE reviewed association? The historical prospect remains "\n'
        '            "unchanged and no emails will be sent.",',
        '            "Create or associate this company in Companies & Contacts? "\n'
        '            "The historical research stays in the audit trail and disappears "\n'
        '            "from the active Research list after confirmation. "\n'
        '            "No contacts or emails will be created.",',
        "confirmation humaine")
    s = replace_once(s,
        "            self.crm_company_search.clear()\n"
        "            self.load_companies()\n"
        "            guided_proposal_id = self.crm_invoice_link_return_proposal_id\n",
        "            self.crm_company_search.clear()\n"
        "            self.load_companies()\n"
        "            self.crm_page = 1\n"
        "            self.load_prospects()\n"
        "            if self.crm_tabs.currentIndex() == 1:\n"
        "                self.crm_tabs.setCurrentIndex(0)\n"
        "            guided_proposal_id = self.crm_invoice_link_return_proposal_id\n",
        "rafraîchir et ouvrir Company & Contacts")
    return s

def prospects_upgrade(s):
    s = replace_once(s,
        "export async function listSalesProspectsPage(pool, request) {",
        "export async function listSalesProspectsPage(pool, request, actor) {",
        "API page avec identité utilisateur")
    s = replace_once(s,
        "  const { search, page, offset } = validateProspectPage(request);\n",
        "  const { search, page, offset } = validateProspectPage(request);\n"
        "  if (typeof actor !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(actor))\n"
        "    throw new Error('CRM invalid operator');\n"
        "  const workspace = 'local:' + actor;\n",
        "séparer la base selon utilisateur")
    s = replace_once(s,
        "           OR POSITION(LOWER($1) IN LOWER(COALESCE(website,''))) > 0)\n"
        "       ),\n",
        "           OR POSITION(LOWER($1) IN LOWER(COALESCE(website,''))) > 0)\n"
        "           AND NOT EXISTS (\n"
        "             SELECT 1 FROM enkyron_crm_prospect_links linked\n"
        "             WHERE linked.workspace_key=$3\n"
        "               AND linked.prospect_id=sales_prospects.id\n"
        "           )\n"
        "       ),\n",
        "masquer uniquement les prospects déjà intégrés au CRM")
    s = replace_once(s, "      [search, offset]\n", "      [search, offset, workspace]\n",
                     "paramètre workspace SQL")
    s = replace_once(s,
        "export function listSalesProspects(pool, search) {\n"
        "  return listSalesProspectsPage(pool, { search, page: 1 });\n",
        "export function listSalesProspects(pool, search, actor) {\n"
        "  return listSalesProspectsPage(pool, { search, page: 1 }, actor);\n",
        "API recherche paginée")
    s = replace_once(s,
        "notice: 'Legacy research candidates, not verified client or contact records.'",
        "notice: 'Unlinked research candidates only; linked sources are retained for audit.'",
        "notice Research")
    return s

def bridge_upgrade(s):
    s = replace_once(s,
        "command === 'crm-prospects' ? await listSalesProspects(pool, arg) :",
        "command === 'crm-prospects' ? await listSalesProspects(pool, arg, os.userInfo().username) :",
        "appel recherche dans bridge")
    s = replace_once(s,
        "command === 'crm-prospects-page' ? await listSalesProspectsPage(pool, payload) :",
        "command === 'crm-prospects-page' ? await listSalesProspectsPage(pool, payload, os.userInfo().username) :",
        "appel pagination dans bridge")
    return s

def tests_upgrade(s):
    cases = (
        ("listSalesProspectsPage(pool,{search:'  Example  ',page:2})",
         "listSalesProspectsPage(pool,{search:'  Example  ',page:2},'ci-operator')"),
        ("listSalesProspectsPage(pool,{search:'Example',page:4})",
         "listSalesProspectsPage(pool,{search:'Example',page:4},'ci-operator')"),
        ("listSalesProspectsPage(pool,{search:'',page:4})",
         "listSalesProspectsPage(pool,{search:'',page:4},'ci-operator')"),
        ("listSalesProspects(pool,candidate)",
         "listSalesProspects(pool,candidate,'ci-operator')"),
        ("},{search:'',page:1})", "},{search:'',page:1},'ci-operator')"),
        ("seen[0].params,['Example',100]",
         "seen[0].params,['Example',100,'local:ci-operator']"),
        ("seen[1].params,['Example',300]",
         "seen[1].params,['Example',300,'local:ci-operator']"),
        ("values,[candidate,0]", "values,[candidate,0,'local:ci-operator']"),
    )
    for old,new in cases:
        n=s.count(old)
        if n < 1 or (old!="},{search:'',page:1})" and n!=1):
            raise ValueError("Test modifié localement: "+old)
        s=s.replace(old,new)
    hook = "  assert.match(seen[0].sql,/^WITH filtered AS/);\n"
    s = replace_once(s,hook,hook+
        "  assert.match(seen[0].sql,/NOT EXISTS/);\n"
        "  assert.match(seen[0].sql,/enkyron_crm_prospect_links/);\n"
        "  assert.match(seen[0].sql,/linked.workspace_key=\\$3/);\n",
        "test filtrage des prospects associés")
    s += ("\n"
        "test('Research requires a scoped local operator',async()=>{\n"
        "  await assert.rejects(()=>listSalesProspectsPage({query:async()=>({rows:[]})},\n"
        "    {search:'',page:1}),/CRM invalid operator/);\n"
        "});\n")
    return s

def main():
    if not (ROOT/".git").is_dir():
        raise ValueError("Répertoire ENKYRON introuvable")
    funcs = {
        PATHS[0]:py_upgrade,
        PATHS[1]:prospects_upgrade,
        PATHS[2]:bridge_upgrade,
        PATHS[3]:tests_upgrade
    }
    old,new={},{}
    for name,fn in funcs.items():
        path=ROOT/name
        if not path.is_file() or path.is_symlink():
            raise ValueError("Fichier absent ou non sûr: "+name)
        old[name]=path.read_text()
        new[name]=fn(old[name])
    compile(new[PATHS[0]], PATHS[0], 'exec')
    for name in PATHS[1:]:
        with tempfile.TemporaryDirectory(prefix='enkyron-validate-') as d:
            tmp=Path(d)/'check.mjs'
            tmp.write_text(new[name])
            proc=subprocess.run(['node','--check',str(tmp)],text=True,capture_output=True)
            if proc.returncode:
                raise ValueError("Syntaxe JS invalide: "+name+"\n"+proc.stderr[-400:])
    base=ROOT/'data'/'backups'
    base.mkdir(parents=True, exist_ok=True)
    backup=base/('research-to-crm-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup.mkdir(mode=0o700)
    modified=[]
    try:
        for name in PATHS:
            path=ROOT/name
            if path.read_text()!=old[name]:
                raise ValueError("Le fichier a changé pendant la vérification: "+name)
            target=backup/name
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(path,target)
        for name in PATHS:
            (ROOT/name).write_text(new[name])
            modified.append(name)
        tests=subprocess.run(['node','--test',
                 'tests/enkyron-crm-prospects.test.js',
                 'tests/enkyron-crm-link.test.js'],
                cwd=ROOT,text=True,capture_output=True)
        if tests.returncode:
            raise RuntimeError("Tests non validés: "+(tests.stdout+tests.stderr)[-1600:])
    except Exception:
        for name in modified:
            shutil.copy2(backup/name, ROOT/name)
        raise
    print("OK: Research -> Companies & Contacts prêt. Tests Node réussis.")
    print("Double-clic sur un candidat = fenêtre de création / liaison CRM.")
    print("Après sauvegarde confirmée, il quitte la liste Research active.")
    print("Données historiques, CRM, emails et PostgreSQL inchangés par l'installation.")
    print("Sauvegardes:",backup)
    print("Redémarre ENKYRON pour tester.")

try:
    main()
except Exception as err:
    sys.exit("ARRÊT SÉCURISÉ: "+str(err))
