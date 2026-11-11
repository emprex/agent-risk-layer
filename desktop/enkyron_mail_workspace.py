"""Native ENKYRON Inbox: clean list/detail mail experience, provider read-only.

All data remains text-only. Mailbox permissions and Resend access are handled
by the backend; this presentation creates no authenticated actions or sends.
"""
from datetime import datetime

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QFrame, QHBoxLayout, QLabel, QLineEdit,
    QListWidget, QListWidgetItem, QMenu, QPlainTextEdit, QPushButton, QSplitter,
    QStackedWidget, QVBoxLayout, QWidget, QTreeWidget, QTreeWidgetItem, QInputDialog,
)


def _display_date(value):
    """Short local display only; preserve untrusted values as plain text."""
    if not isinstance(value, str) or not value:
        return ""
    try:
        instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return instant.astimezone().strftime("%d %b %Y · %H:%M")
    except (ValueError, OverflowError):
        return value[:32]


def format_mail_messages(messages):
    """Safe text-only conversation rendering; never interpret HTML or links."""
    if not isinstance(messages, list):
        return ""
    parts = []
    for item in messages[:50]:
        if not isinstance(item, dict):
            continue
        recipients = item.get("to") if isinstance(item.get("to"), list) else []
        header = "From: {}\nTo: {}\nDate: {}\nSubject: {}".format(
            str(item.get("from") or "")[:254],
            ", ".join(str(v) for v in recipients[:20])[:500],
            str(item.get("created_at") or "")[:64],
            str(item.get("subject") or "")[:300],
        )
        body = str(item.get("text") or "")[:20000]
        if not body and item.get("html_only"):
            body = "[HTML-only message: safe text preview not available]"
        parts.append(header + "\n\n" + body)
    return ("\n\n" + ("─" * 30) + "\n\n").join(parts)


class MailInboxView(QWidget):
    """Compact Inbox with an empty state, searchable list and reading pane."""

    mailboxChanged = Signal(str)
    folderChanged = Signal(str)
    threadMoveRequested = Signal(str, str, str, str)
    refreshRequested = Signal(str)
    threadRequested = Signal(str, str)
    threadOpenRequested = Signal(str, str)
    draftsRequested = Signal()
    sentRequested = Signal()
    deskRequested = Signal()
    newEmailRequested = Signal()
    localMoveRequested = Signal(str, str, str)
    localCreateFolderRequested = Signal(str)
    localRenameFolderRequested = Signal(str, str)
    localDeleteFolderRequested = Signal(str)
    localCreateLabelRequested = Signal(str)
    localAssignLabelRequested = Signal(str, str, str, bool)
    localFlagRequested = Signal(str, str, bool)
    localReadRequested = Signal(str, str, bool)
    localSearchRequested = Signal(str)
    localPageRequested = Signal(int)
    localRecordRequested = Signal(str, int)
    localRecordOpenRequested = Signal(str, int)
    localRecordLinkRequested = Signal(int)
    replyRequested = Signal(str, str)
    forwardRequested = Signal(str, str)
    replySubmitRequested = Signal()
    sentFollowUpRequested = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.connection_state = "disconnected"
        self.current_thread_id = None
        self.current_thread_mailbox = None
        self.items = []
        self._has_more = False
        self._local_page = 0
        self._local_search_query = None
        self._mailboxes = {}
        self._filing_mailboxes = set()
        self._folder = 'inbox'
        self.local_mode = False
        self.local_folders = []
        self.local_labels = []
        self._build()

    def _build(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 12, 16, 12)
        root.setSpacing(10)

        # One compact toolbar; the Inbox tab is already the page title.
        toolbar = QHBoxLayout()
        toolbar.setSpacing(10)
        self.account_picker = QComboBox()
        self.account_picker.setObjectName("enkyronMailAccountPicker")
        self.account_picker.setMinimumWidth(230)
        self.account_picker.setAccessibleName("Filter messages by email account")
        self.account_picker.setToolTip("Inbox account")
        self.account_picker.currentIndexChanged.connect(self._account_changed)
        toolbar.addWidget(self.account_picker, 0)
        self.folder_picker = QComboBox()
        self.folder_picker.setObjectName('enkyronMailFolderPicker')
        self.folder_picker.setAccessibleName('Mail folder')
        for label, key in [('Inbox','inbox'), ('Archive','archive'),
                           ('Spam','spam'), ('Trash','trash')]:
            self.folder_picker.addItem(label, key)
        self.folder_picker.currentIndexChanged.connect(self._folder_changed)
        toolbar.addWidget(self.folder_picker, 0)
        self.search = QLineEdit()
        self.search.setObjectName("enkyronMailSearch")
        self.search.setPlaceholderText("Search loaded conversations…")
        self.search.setAccessibleName("Search loaded conversations")
        self.search.setMaxLength(120)
        self.search.setEnabled(False)
        self.search.textChanged.connect(self._filter)
        self.search.returnPressed.connect(self._search_saved_mail)
        toolbar.addWidget(self.search, 1)
        self.refresh_button = QPushButton("Refresh")
        self.refresh_button.setObjectName("enkyronMailRefresh")
        self.refresh_button.setToolTip("Fetch the latest conversations from Resend.")
        self.refresh_button.setEnabled(False)
        self.refresh_button.clicked.connect(self._refresh)
        toolbar.addWidget(self.refresh_button)
        self.new_email_button = QPushButton("New email")
        self.new_email_button.setObjectName("enkyronMailCompose")
        self.new_email_button.clicked.connect(self.newEmailRequested.emit)
        toolbar.addWidget(self.new_email_button)
        root.addLayout(toolbar)

        self.connection_label = QLabel(
            "Email is offline. Connect the mail service to receive messages."
        )
        self.connection_label.setObjectName("enkyronMailConnectionStatus")
        self.connection_label.setTextFormat(Qt.TextFormat.PlainText)
        self.connection_label.setWordWrap(True)
        root.addWidget(self.connection_label)

        # Backward-compatible navigation hooks; not extra buttons in the Inbox.
        self.local_drafts_button = QPushButton("Open local drafts", self)
        self.local_drafts_button.setObjectName("enkyronMailOpenDrafts")
        self.local_drafts_button.clicked.connect(self.draftsRequested.emit)
        self.local_drafts_button.hide()
        self.client_desk_button = QPushButton("Open Client Desk", self)
        self.client_desk_button.setObjectName("enkyronMailOpenClientDesk")
        self.client_desk_button.clicked.connect(self.deskRequested.emit)
        self.client_desk_button.hide()

        self.mail_stack = QStackedWidget()
        self.mail_stack.setObjectName("enkyronMailContentStack")

        empty_page = QWidget()
        empty_layout = QVBoxLayout(empty_page)
        empty_layout.setContentsMargins(20, 30, 20, 30)
        empty_layout.addStretch(2)
        empty_symbol = QLabel("✉")
        empty_symbol.setObjectName("enkyronMailEmptySymbol")
        empty_symbol.setAlignment(Qt.AlignmentFlag.AlignCenter)
        empty_symbol.setStyleSheet("font-size: 34px; color: #7891a1;")
        empty_layout.addWidget(empty_symbol)
        self.empty_title = QLabel("Inbox is empty")
        self.empty_title.setObjectName("enkyronMailEmptyTitle")
        self.empty_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_title.setStyleSheet(
            "font-size: 17px; font-weight: 600; color: #20354a;"
        )
        empty_layout.addWidget(self.empty_title)
        self.empty_explanation = QLabel("No messages yet.")
        self.empty_explanation.setObjectName("enkyronMailEmptyExplanation")
        self.empty_explanation.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_explanation.setTextFormat(Qt.TextFormat.PlainText)
        self.empty_explanation.setWordWrap(True)
        self.empty_explanation.setStyleSheet("color: #60768a;")
        empty_layout.addWidget(self.empty_explanation)
        empty_layout.addStretch(3)
        self.mail_stack.addWidget(empty_page)

        self.splitter = QSplitter(Qt.Orientation.Horizontal)
        self.splitter.setChildrenCollapsible(False)
        self.splitter.setObjectName("enkyronMailSplitView")
        self.splitter.setHandleWidth(5)

        left = QFrame()
        left.setObjectName("enkyronMailListPane")
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(0, 0, 8, 0)
        left_layout.setSpacing(8)
        list_heading = QHBoxLayout()
        list_heading.addWidget(QLabel("Conversations"))
        list_heading.addStretch()
        self.count = QLabel("0 conversations")
        self.count.setObjectName("enkyronMailCount")
        self.count.setTextFormat(Qt.TextFormat.PlainText)
        self.count.setStyleSheet("color: #60768a;")
        list_heading.addWidget(self.count)
        left_layout.addLayout(list_heading)
        self.thread_list = QListWidget()
        self.thread_list.setObjectName("enkyronMailThreadList")
        self.thread_list.setAccessibleName("Conversations in selected mailbox")
        self.thread_list.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.thread_list.setStyleSheet(
            "QListWidget { background: white; border: 1px solid #d8e2ea;"
            " border-radius: 6px; outline: 0; }"
            "QListWidget::item { padding: 11px 9px; border-bottom: 1px solid #edf2f6; }"
            "QListWidget::item:selected { background: #e4f3f8; color: #20354a; }"
            "QListWidget::item:hover { background: #f0f6fa; }"
        )
        self.thread_list.currentItemChanged.connect(self._selected)
        self.thread_list.itemDoubleClicked.connect(self._open_current_thread)
        self.thread_list.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.thread_list.customContextMenuRequested.connect(self._thread_context_menu)
        left_layout.addWidget(self.thread_list, 1)
        self.local_page_toolbar = QHBoxLayout()
        self.local_earlier_button = QPushButton("Newer")
        self.local_earlier_button.setObjectName("enkyronMailNewerPage")
        self.local_earlier_button.clicked.connect(
            lambda: self.localPageRequested.emit(max(0, self._local_page - 1)))
        self.local_later_button = QPushButton("Older")
        self.local_later_button.setObjectName("enkyronMailOlderPage")
        self.local_later_button.clicked.connect(
            lambda: self.localPageRequested.emit(self._local_page + 1))
        self.local_earlier_button.hide()
        self.local_later_button.hide()
        self.local_page_toolbar.addWidget(self.local_earlier_button)
        self.local_page_toolbar.addWidget(self.local_later_button)
        left_layout.addLayout(self.local_page_toolbar)
        self.splitter.addWidget(left)

        self.reader_stack = QStackedWidget()
        self.reader_stack.setObjectName("enkyronMailReaderStack")
        choose_page = QWidget()
        choose_layout = QVBoxLayout(choose_page)
        choose_layout.addStretch()
        choose_text = QLabel("Select a conversation to read it")
        self.reader_empty_text = choose_text
        choose_text.setAlignment(Qt.AlignmentFlag.AlignCenter)
        choose_text.setStyleSheet("color: #60768a; font-size: 14px;")
        choose_layout.addWidget(choose_text)
        choose_layout.addStretch()
        self.reader_stack.addWidget(choose_page)

        right = QFrame()
        right.setObjectName("enkyronMailReadingPane")
        right_layout = QVBoxLayout(right)
        right_layout.setContentsMargins(14, 0, 0, 0)
        right_layout.setSpacing(8)
        self.subject = QLabel("Select a message")
        self.subject.setObjectName("enkyronMailSubject")
        self.subject.setTextFormat(Qt.TextFormat.PlainText)
        self.subject.setWordWrap(True)
        self.subject.setStyleSheet("font-size: 16px; font-weight: 600;")
        right_layout.addWidget(self.subject)
        self.meta = QLabel("")
        self.meta.setObjectName("enkyronMailMeta")
        self.meta.setTextFormat(Qt.TextFormat.PlainText)
        self.meta.setWordWrap(True)
        self.meta.setStyleSheet("color: #60768a;")
        right_layout.addWidget(self.meta)
        self.body = QPlainTextEdit()
        self.body.setObjectName("enkyronMailPlainTextPreview")
        self.body.setAccessibleName("Read-only plain-text conversation")
        self.body.setReadOnly(True)
        self.body.setPlainText("")
        right_layout.addWidget(self.body, 1)
        reply_toolbar = QHBoxLayout()
        self.reply_button = QPushButton("Reply")
        self.reply_button.setObjectName("enkyronMailReply")
        self.reply_button.setToolTip("Reply to this message")
        self.reply_button.clicked.connect(self._request_reply)
        self.reply_button.hide()
        reply_toolbar.addWidget(self.reply_button)
        self.forward_button = QPushButton("Forward")
        self.forward_button.setObjectName("enkyronMailForward")
        self.forward_button.setToolTip(
            "Prepare a text-only forward for review; never sends automatically")
        self.forward_button.clicked.connect(self._request_forward)
        self.forward_button.hide()
        reply_toolbar.addWidget(self.forward_button)
        reply_toolbar.addStretch()
        right_layout.addLayout(reply_toolbar)
        self.reply_editor = QFrame()
        self.reply_editor.setObjectName("enkyronMailInlineReply")
        reply_layout = QVBoxLayout(self.reply_editor)
        reply_layout.setContentsMargins(0, 6, 0, 0)
        self.reply_target = QLabel("")
        self.reply_target.setWordWrap(True)
        self.reply_target.setTextFormat(Qt.TextFormat.PlainText)
        reply_layout.addWidget(self.reply_target)
        self.reply_body = QPlainTextEdit()
        self.reply_body.setObjectName("enkyronMailReplyBody")
        self.reply_body.setPlaceholderText("Write your reply…")
        self.reply_body.setMinimumHeight(130)
        reply_layout.addWidget(self.reply_body)
        reply_actions = QHBoxLayout()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self.hide_reply_editor)
        reply_actions.addWidget(cancel)
        reply_actions.addStretch()
        self.reply_send = QPushButton("Send reply…")
        self.reply_send.setObjectName("enkyronMailSendReply")
        self.reply_send.clicked.connect(self.replySubmitRequested.emit)
        reply_actions.addWidget(self.reply_send)
        reply_layout.addLayout(reply_actions)
        self.reply_editor.hide()
        right_layout.addWidget(self.reply_editor)
        self.reader_stack.addWidget(right)
        self.reader_stack.setCurrentIndex(0)
        self.splitter.addWidget(self.reader_stack)
        self.splitter.setSizes([440, 720])
        self.mail_stack.addWidget(self.splitter)
        root.addWidget(self.mail_stack, 1)

        self._show_empty("Inbox is empty", "No messages yet.")

    @property
    def selected_mailbox(self):
        return self.account_picker.currentData()

    @property
    def selected_folder(self):
        return self._folder if self.local_mode else self.folder_picker.currentData()

    def _show_empty(self, title, detail):
        self.empty_title.setText(title)
        self.empty_explanation.setText(detail)
        if self.local_mode:
            self.reader_empty_text.setText(title + '\n\n' + detail)
            self.reader_stack.setCurrentIndex(0)
            self.mail_stack.setCurrentIndex(1)
        else:
            self.mail_stack.setCurrentIndex(0)

    def set_local_mode(self):
        """Local folders own the organization; Resend is transport only."""
        if self.local_mode:
            return
        self.local_mode = True
        self.folder_picker.hide()
        self.refresh_button.setText("Send / Receive")
        self.refresh_button.setToolTip(
            "Automatic Inbox check every 60 seconds while ENKYRON is open. "
            "Send / Receive runs the full manual synchronization; no provider mail is moved."
        )
        self.search.setPlaceholderText("Search all saved mail · press Enter")
        self.search.setAccessibleName("Search saved mail in NEMORYTH; press Enter")
        self.local_earlier_button.show()
        self.local_later_button.show()
        self.local_earlier_button.setEnabled(False)
        self.local_later_button.setEnabled(False)
        left = QFrame()
        left.setObjectName("enkyronMailFolderSidebar")
        layout = QVBoxLayout(left)
        layout.setContentsMargins(4, 2, 6, 2)
        head = QHBoxLayout()
        head.addWidget(QLabel("FOLDERS"))
        head.addStretch()
        add = QPushButton("+")
        add.setObjectName("enkyronMailFolderAdd")
        add.setFixedWidth(34)
        add.setToolTip("Create a folder inside ENKYRON")
        add.clicked.connect(self.create_folder_prompt)
        head.addWidget(add)
        layout.addLayout(head)
        self.folder_tree = QTreeWidget()
        self.folder_tree.setObjectName("enkyronMailLocalFolderTree")
        self.folder_tree.setHeaderHidden(True)
        self.folder_tree.setRootIsDecorated(False)
        self.folder_tree.setMinimumWidth(145)
        self.folder_tree.setMaximumWidth(270)
        self.folder_tree.itemClicked.connect(self.select_local_folder)
        self.folder_tree.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.folder_tree.customContextMenuRequested.connect(self._folder_context_menu)
        layout.addWidget(self.folder_tree)
        self.splitter.insertWidget(0, left)
        self.splitter.setSizes([195, 380, 700])
        self._local_folder_rows([
            {"key":key, "name":name, "system":True}
            for key,name in [
                ("inbox","Inbox"), ("sent","Sent"), ("drafts","Drafts"),
                ("archive","Archive"), ("spam","Spam"), ("trash","Trash")
            ]
        ])
        self.set_connection_state("connected")
        self._show_empty("Inbox is empty",
                         "Press Send / Receive to import from Resend.")

    def _local_folder_rows(self, folders):
        current = self._folder
        self.local_folders = list(folders)
        if not self.local_mode:
            return
        self.folder_tree.blockSignals(True)
        self.folder_tree.clear()
        selected = None
        for folder in self.local_folders:
            if not isinstance(folder, dict):
                continue
            key = folder.get("key")
            name = folder.get("name")
            if not isinstance(key, str) or not isinstance(name, str):
                continue
            item = QTreeWidgetItem([name])
            item.setData(0, Qt.ItemDataRole.UserRole, key)
            self.folder_tree.addTopLevelItem(item)
            if key == current:
                selected = item
        if selected:
            self.folder_tree.setCurrentItem(selected)
        self.folder_tree.blockSignals(False)

    def _folder_context_menu(self, pos):
        """Rename or remove only user-created folders, never provider mail."""
        if not self.local_mode:
            return
        item = self.folder_tree.itemAt(pos)
        if item is None:
            return
        key = item.data(0, Qt.ItemDataRole.UserRole)
        folder = next((f for f in self.local_folders
                       if isinstance(f, dict) and f.get("key") == key), None)
        if not folder or folder.get("system") is not False:
            return
        menu = QMenu(self)
        rename = menu.addAction("Rename folder…")
        delete = menu.addAction("Delete empty folder…")
        selected = menu.exec(self.folder_tree.viewport().mapToGlobal(pos))
        if selected == rename:
            name, accepted = QInputDialog.getText(
                self, "Rename local folder", "Folder name:",
                text=str(folder.get("name") or ""))
            if accepted and name.strip() and name.strip() != folder.get("name"):
                self.localRenameFolderRequested.emit(key, name.strip())
        elif selected == delete:
            # The server additionally refuses deletion when messages remain.
            self.localDeleteFolderRequested.emit(key)

    def set_local_folders(self, folders):
        if isinstance(folders, list):
            self._local_folder_rows(folders)

    def set_local_labels(self, labels):
        self.local_labels = labels if isinstance(labels, list) else []

    def select_local_folder(self, item, _column):
        self.activate_local_folder(item.data(0, Qt.ItemDataRole.UserRole))

    def activate_local_folder(self, folder):
        """Navigate with one folder tree, with no secondary Sent/Drafts pages."""
        if not self.local_mode or not isinstance(folder, str):
            return
        keys = {f.get("key") for f in self.local_folders if isinstance(f, dict)}
        if folder not in keys or folder == self._folder:
            return
        self._folder = folder
        for row in range(self.folder_tree.topLevelItemCount()):
            node = self.folder_tree.topLevelItem(row)
            if node.data(0, Qt.ItemDataRole.UserRole) == folder:
                self.folder_tree.blockSignals(True)
                self.folder_tree.setCurrentItem(node)
                self.folder_tree.blockSignals(False)
                break
        self._clear_threads("No saved messages in this folder.")
        if self.selected_mailbox is not None:
            self.folderChanged.emit(folder)

    def create_folder_prompt(self):
        if not self.local_mode:
            return
        name, accepted = QInputDialog.getText(
            self, "New local folder", "Folder name:")
        if accepted and name.strip():
            self.localCreateFolderRequested.emit(name.strip())

    def _local_context_menu(self, item, pos):
        record = item.data(Qt.ItemDataRole.UserRole)
        if not isinstance(record, tuple) or len(record) != 2:
            return
        mailbox, thread_id = record
        if mailbox in ("local-sent", "local-drafts"):
            menu = QMenu(self)
            action = menu.addAction(
                "Open sent message" if mailbox == "local-sent" else "Edit draft"
            )
            action.triggered.connect(
                lambda _checked=False: self.localRecordOpenRequested.emit(
                    mailbox.removeprefix("local-"), thread_id
                )
            )
            if mailbox == "local-sent":
                entry = self.items[thread_id] if 0 <= thread_id < len(self.items) else {}
                if entry.get("draft_id") and not entry.get("company_id"):
                    link = menu.addAction("Link to CRM…")
                    link.triggered.connect(
                        lambda _checked=False: self.localRecordLinkRequested.emit(thread_id)
                    )
            menu.exec(self.thread_list.mapToGlobal(pos))
            return
        if mailbox not in self._mailboxes:
            return
        menu = QMenu(self)
        entry_index = self.thread_list.row(item)
        entry = self.items[entry_index] if 0 <= entry_index < len(self.items) else {}
        flagged = bool(isinstance(entry, dict) and entry.get("flagged") is True)
        unread = bool(isinstance(entry, dict) and entry.get("unread") is True)
        read_action = menu.addAction("Mark as read" if unread else "Mark as unread")
        read_action.triggered.connect(
            lambda _checked=False: self.localReadRequested.emit(
                mailbox, thread_id, not unread))
        menu.addSeparator()
        action = menu.addAction("Remove follow-up flag" if flagged else "Flag for follow-up")
        action.triggered.connect(
            lambda _checked=False: self.localFlagRequested.emit(
                mailbox, thread_id, not flagged))
        menu.addSeparator()
        move = menu.addMenu("Move to folder")
        for folder in self.local_folders:
            key = folder.get("key")
            if key in ("sent","drafts",self._folder):
                continue
            action = move.addAction(folder.get("name") or key)
            action.triggered.connect(
                lambda _checked=False, destination=key:
                self.localMoveRequested.emit(mailbox, thread_id, destination)
            )
        labels = menu.addMenu("Labels")
        for entry in self.local_labels:
            ident = entry.get("id")
            action = labels.addAction(str(entry.get("name") or "Label"))
            action.setCheckable(True)
            applied = str(entry.get("name") or "") in (
                self.items[self.thread_list.row(item)].get("labels") or ""
            ).split(", ")
            action.setChecked(applied)
            action.triggered.connect(
                lambda checked=False, label=ident:
                self.localAssignLabelRequested.emit(mailbox, thread_id, label, checked)
            )
        labels.addSeparator()
        labels.addAction("Create new label…", self.create_label_prompt)
        menu.exec(self.thread_list.mapToGlobal(pos))

    def create_label_prompt(self):
        name, accepted = QInputDialog.getText(
            self, "New mail label", "Label name:")
        if accepted and name.strip():
            self.localCreateLabelRequested.emit(name.strip())

    def set_filing_mailboxes(self, keys):
        # Read-only presentation hint, not a security permission grant.
        self._filing_mailboxes = set(keys or []) & {'direction','support'}

    def set_owner_mailboxes(self, card):
        """Labels supplied by trusted Owner card; no permission derived in Qt."""
        entries = card.get("mailboxes", []) if isinstance(card, dict) else []
        validated = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            key, address = entry.get("key"), entry.get("address")
            if key not in ("direction", "support") or not isinstance(address, str):
                continue
            if len(address) > 254 or "@" not in address or "\n" in address:
                continue
            validated.append((key, address))
        if {key for key, _ in validated} != {"direction", "support"} or len(validated) != 2:
            self._mailboxes = {}
            self.account_picker.blockSignals(True)
            self.account_picker.clear()
            self.account_picker.blockSignals(False)
            self._clear_threads("Email accounts unavailable.")
            return
        previous = self.selected_mailbox
        self._mailboxes = dict(validated)
        self.account_picker.blockSignals(True)
        self.account_picker.clear()
        self.account_picker.addItem("All mail", "all")
        for key, address in validated:
            self.account_picker.addItem(address, key)
        idx = self.account_picker.findData(previous)
        self.account_picker.setCurrentIndex(idx if idx >= 0 else 0)
        self.account_picker.blockSignals(False)
        self._clear_threads("No messages yet.")

    def set_connection_state(self, state, explanation=None):
        """Display only. Never grants any authorization or sends mail."""
        if state not in ("disconnected", "loading", "connected", "error"):
            raise ValueError("Invalid mail connection state")
        self.connection_state = state
        defaults = {
            "disconnected": "Email is offline. Connect the mail service to receive messages.",
            "loading": "Loading conversations…",
            "connected": "",
            "error": "Unable to load conversations. Try Refresh.",
        }
        self.connection_label.setText(str(explanation or defaults[state])[:180])
        self.connection_label.setVisible(state != "connected")
        active = state in ("connected", "error") and bool(self._mailboxes)
        self.refresh_button.setEnabled(active)
        self.search.setEnabled(state == "connected" and bool(self._mailboxes))
        if state in ("disconnected", "loading", "error"):
            # The previous loading pane must never remain visible on failure.
            self._clear_threads(str(explanation or defaults[state])[:180])

    def _clear_threads(self, explanation, preserve_search=False):
        self.hide_reply_editor()
        self.reply_button.hide()
        self.forward_button.hide()
        self.current_thread_id = None
        self.current_thread_mailbox = None
        self.items = []
        self._has_more = False
        self._local_page = 0
        if not preserve_search:
            self._local_search_query = None
        self.thread_list.blockSignals(True)
        self.thread_list.clear()
        self.thread_list.blockSignals(False)
        if not preserve_search:
            self.search.blockSignals(True)
            self.search.clear()
            self.search.blockSignals(False)
        if self.local_mode:
            self.local_earlier_button.setEnabled(False)
            self.local_later_button.setEnabled(False)
        self.count.setText("0 conversations")
        self.subject.setText("Select a message")
        self.meta.setText("")
        self.body.setPlainText(explanation)
        self.reader_stack.setCurrentIndex(0)
        if self.connection_state == "loading":
            self._show_empty("Checking for new mail", explanation)
        elif self.connection_state == "error":
            self._show_empty("Couldn't load mail", explanation)
        elif self.connection_state == "disconnected":
            self._show_empty("Mail unavailable", explanation)
        else:
            self._show_empty("Inbox is empty", explanation)

    def _account_changed(self, _index):
        self._clear_threads("No messages yet.")
        if self.selected_mailbox is not None:
            self.mailboxChanged.emit(self.selected_mailbox)

    def _folder_changed(self, _index):
        folder = self.selected_folder
        if folder not in ('inbox','archive','spam','trash'):
            return
        self._folder = folder
        self._clear_threads('No conversations in this folder.')
        if self.selected_mailbox is not None:
            self.folderChanged.emit(folder)

    def _thread_context_menu(self, pos):
        item = self.thread_list.itemAt(pos)
        if item is None or self.connection_state != 'connected':
            return
        details = item.data(Qt.ItemDataRole.UserRole)
        if not isinstance(details, tuple) or len(details) != 2:
            return
        self.thread_list.setCurrentItem(item)
        if self.local_mode:
            self._local_context_menu(item, pos)
            return
        if details[0] not in self._filing_mailboxes:
            return
        menu = QMenu(self)
        current = self.selected_folder
        for label, target in [('Move to Inbox','inbox'), ('Archive','archive'),
                              ('Mark as Spam','spam'), ('Move to Trash','trash')]:
            if target == current:
                continue
            action = menu.addAction(label)
            action.triggered.connect(
                lambda checked=False, folder=target: self._request_thread_move(folder)
            )
        menu.exec(self.thread_list.mapToGlobal(pos))

    def _request_thread_move(self, target):
        if (self.connection_state != 'connected' or target not in
                ('inbox','archive','spam','trash') or target == self.selected_folder):
            return
        selected = self.thread_list.currentItem()
        if selected is None:
            return
        source = selected.data(Qt.ItemDataRole.UserRole)
        if (isinstance(source, tuple) and len(source) == 2
                and source[0] in self._filing_mailboxes):
            self.threadMoveRequested.emit(source[0], source[1],
                                          self.selected_folder, target)

    def _refresh(self):
        if (self.connection_state in ("connected", "error")
                and (self.selected_mailbox in self._mailboxes
                     or self.selected_mailbox == "all")):
            self.refreshRequested.emit(self.selected_mailbox)

    def show_threads(self, mailbox, items, has_more=False, folder='inbox',
                     search_query=None, page=0, preserve_reader=False):
        """Provider-scoped, bounded plain-text thread listing."""
        if (self.connection_state != 'connected' or mailbox != self.selected_mailbox
                or folder != self.selected_folder):
            return False
        if not isinstance(items, list) or len(items) > (200 if self.local_mode else 50):
            return False
        # Automatic Inbox updates must not discard the selected conversation
        # or any unsent inline reply currently being typed by the operator.
        live = bool(preserve_reader and self.local_mode and folder == "inbox"
                    and page == 0 and not self.search.text().strip()
                    and not self._local_search_query)
        if preserve_reader and not live:
            return False
        selected = self.thread_list.currentItem() if live else None
        selected_ref = (selected.data(Qt.ItemDataRole.UserRole)
                        if selected is not None else None)
        if live:
            self.thread_list.blockSignals(True)
            self.thread_list.clear()
            self.thread_list.blockSignals(False)
        else:
            self._clear_threads("No conversations in this folder.",
                                preserve_search=search_query is not None)
        self._local_search_query = (
            search_query.strip().casefold()
            if self.local_mode and isinstance(search_query, str) and search_query.strip()
            else None
        )
        self._local_page = page if isinstance(page, int) and page >= 0 else 0
        if self.local_mode:
            self.local_earlier_button.setEnabled(self._local_page > 0)
            self.local_later_button.setEnabled(bool(has_more))
        self.items = list(items)
        self._has_more = bool(has_more)
        self.thread_list.blockSignals(True)
        for item in items:
            if not isinstance(item, dict):
                continue
            thread_id = str(item.get("id") or "")
            if not thread_id or len(thread_id) > 100:
                continue
            source = str(item.get("mailbox") or mailbox)
            if source not in self._mailboxes:
                continue
            subject = str(item.get("subject") or "(No subject)")[:300]
            date = _display_date(item.get("last_message_at"))
            unread = item.get("unread") is True
            label = ("● " if unread else "") + subject
            if self.local_mode and item.get("flagged") is True:
                label = "★ " + label
            if self.local_mode:
                sender = str(item.get("sender") or "").strip()[:120]
                if sender:
                    label = ("● " if unread else "") + sender + "\n" + subject
                if item.get("flagged") is True:
                    label = "★ " + label.removeprefix("★ ")
                tags = str(item.get("labels") or "").strip()
                if tags:
                    label += "   [" + tags[:80] + "]"
            label += ("\n" + date if date else "")
            entry = QListWidgetItem(label)
            entry.setData(Qt.ItemDataRole.UserRole, (source, thread_id))
            entry.setToolTip(subject + ("\n" + date if date else ""))
            if unread:
                font = QFont(entry.font())
                font.setBold(True)
                entry.setFont(font)
            self.thread_list.addItem(entry)
        if live and selected_ref:
            for i in range(self.thread_list.count()):
                row = self.thread_list.item(i)
                if row.data(Qt.ItemDataRole.UserRole) == selected_ref:
                    self.thread_list.setCurrentItem(row)
                    break
        self.thread_list.blockSignals(False)
        count = self.thread_list.count()
        self.count.setText(
            "{} conversation(s){}.".format(count, " · More available" if has_more else "")
        )
        self._filter(self.search.text())
        return True

    def show_local_records(self, kind, records, more=False):
        """Show Sent and Drafts in the same three-pane workspace as Inbox."""
        if not self.local_mode or kind not in ("sent", "drafts") or self._folder != kind:
            return False
        if not isinstance(records, list):
            return False
        self._clear_threads("No messages in this folder.")
        self.items = list(records[:200])
        self._has_more = bool(more or len(records) > 200)
        self.thread_list.blockSignals(True)
        for index, record in enumerate(self.items):
            if not isinstance(record, dict):
                continue
            account = record.get("mailbox_key")
            # Do not attribute a draft with missing account metadata to an account.
            if self.selected_mailbox != "all" and account != self.selected_mailbox:
                continue
            subject = str(record.get("subject") or "(No subject)")[:300]
            recipient = str(record.get("recipient_email") or "Recipient not set")[:120]
            date = _display_date(record.get("updated_at") or record.get("created_at") or record.get("recorded_at") or record.get("completed_at"))
            state = (str(record.get("mail_state") or "draft").replace("_", " ")
                     if kind == "drafts" else
                     "Submitted to provider" if record.get("outcome") == "accepted"
                     else "Submission uncertain")
            label = recipient + "\n" + subject + "\n" + state
            if date:
                label += " · " + date
            item = QListWidgetItem(label)
            item.setData(Qt.ItemDataRole.UserRole, ("local-" + kind, index))
            item.setToolTip(subject)
            self.thread_list.addItem(item)
        self.thread_list.blockSignals(False)
        self._filter(self.search.text())
        return True

    def update_local_sent_delivery(self, index, status):
        """Expose verified provider state in the same Sent message list."""
        if not self.local_mode or self._folder != "sent":
            return False
        if not 0 <= index < len(self.items):
            return False
        record = self.items[index]
        if not isinstance(record, dict):
            return False
        for row in range(self.thread_list.count()):
            item = self.thread_list.item(row)
            if item.data(Qt.ItemDataRole.UserRole) != ("local-sent", index):
                continue
            recipient = str(record.get("recipient_email") or "Recipient not set")[:120]
            subject = str(record.get("subject") or "(No subject)")[:300]
            date = _display_date(record.get("updated_at") or record.get("created_at") or record.get("recorded_at") or record.get("completed_at"))
            item.setText(recipient + "\n" + subject + "\n"
                         + str(status)[:100] + (" · " + date if date else ""))
            return True
        return False

    def show_local_record_preview(self, kind, index, body, metadata):
        """Render fetched CRM draft content as inert plain text only."""
        selected = self.thread_list.currentItem()
        if (selected is None or selected.data(Qt.ItemDataRole.UserRole)
                != ("local-" + kind, index) or kind != self._folder):
            return False
        self.body.setPlainText(str(body or "")[:20000])
        self.meta.setText(str(metadata or "")[:500])
        self.reader_stack.setCurrentIndex(1)
        # For an outbound message, continuing the relationship is a new
        # human-approved follow-up, not a reply to a received email.
        record = self.items[index] if 0 <= index < len(self.items) else {}
        follow_up_ready = (
            kind == "sent" and isinstance(record, dict)
            and record.get("outcome") == "accepted"
            and bool(record.get("draft_id"))
            and bool(record.get("recipient_email"))
            and record.get("mailbox_key") in self._mailboxes
        )
        self.reply_button.setText("Follow up")
        self.reply_button.setToolTip("Write a new follow-up to this recipient")
        self.reply_button.setVisible(follow_up_ready)
        return True

    def _search_saved_mail(self):
        if self.local_mode and self.connection_state == "connected":
            self.localSearchRequested.emit(self.search.text().strip())

    def _filter(self, value):
        query = value.strip().casefold()
        visible = 0
        for index in range(self.thread_list.count()):
            item = self.thread_list.item(index)
            # Database search can match cached bodies, recipients and labels,
            # none of which need to appear in the row's visible title.
            server_match = (self.local_mode and self._local_search_query
                            and query == self._local_search_query)
            hidden = False if server_match else query not in item.text().casefold()
            item.setHidden(hidden)
            visible += not hidden
        total = self.thread_list.count()
        summary = (
            "{} of {} conversations".format(visible, total)
            if query else "{} conversation(s)".format(total)
        )
        self.count.setText(
            summary + (" · more available" if self._has_more else "")
        )
        selected = self.thread_list.currentItem()
        if selected is not None and selected.isHidden():
            self.thread_list.setCurrentRow(-1)
        if self.connection_state != "connected":
            return
        if total == 0:
            title = {'inbox':'Inbox is empty', 'archive':'Archive is empty',
                     'spam':'No spam', 'trash':'Trash is empty',
                     'sent':'No sent mail', 'drafts':'No drafts'}.get(
                         self.selected_folder, 'Folder is empty'
                     )
            self._show_empty(title,
                'No conversations in this folder.')
        elif visible == 0:
            self._show_empty("No matching conversations",
                "Try a different search term.")
        else:
            self.mail_stack.setCurrentIndex(1)

    def _selected(self, current, _previous):
        self.hide_reply_editor()
        self.reply_button.hide()
        self.forward_button.hide()
        self.current_thread_id = None
        self.current_thread_mailbox = None
        self.subject.setText("Select a message")
        self.body.clear()
        self.meta.setText("")
        self.reader_stack.setCurrentIndex(0)
        if not current or self.connection_state != "connected" or not self._mailboxes:
            return
        reference = current.data(Qt.ItemDataRole.UserRole)
        if not isinstance(reference, tuple) or len(reference) != 2:
            return
        source, thread_id = reference
        if self.local_mode and source in ("local-sent", "local-drafts"):
            kind = source.removeprefix("local-")
            if not isinstance(thread_id, int) or not 0 <= thread_id < len(self.items):
                return
            record = self.items[thread_id]
            self.subject.setText(str(record.get("subject") or "(No subject)")[:300])
            self.meta.setText("Loading saved message…")
            self.body.setPlainText("Loading saved message…")
            self.reader_stack.setCurrentIndex(1)
            self.localRecordRequested.emit(kind, thread_id)
            return
        if source not in self._mailboxes:
            return
        self.current_thread_mailbox = source
        self.current_thread_id = thread_id
        row = self.thread_list.row(current)
        record = self.items[row] if 0 <= row < len(self.items) else {}
        self.subject.setText(
            str(record.get("subject") or "(No subject)")[:300]
            if isinstance(record, dict)
            else current.text().split("\n", 1)[0].removeprefix("● ")
        )
        self.body.setPlainText("Loading conversation…")
        self.reader_stack.setCurrentIndex(1)
        self.threadRequested.emit(source, thread_id)

    def _open_current_thread(self, current):
        if not current or self.connection_state != "connected":
            return
        reference = current.data(Qt.ItemDataRole.UserRole)
        if not isinstance(reference, tuple) or len(reference) != 2:
            return
        source, thread_id = reference
        if self.local_mode and source in ("local-sent", "local-drafts"):
            if isinstance(thread_id, int):
                self.localRecordOpenRequested.emit(source.removeprefix("local-"), thread_id)
        elif source in self._mailboxes:
            self.threadOpenRequested.emit(source, thread_id)

    def _request_reply(self):
        current = self.thread_list.currentItem()
        reference = (current.data(Qt.ItemDataRole.UserRole)
                     if current is not None else None)
        if (self.local_mode and self.selected_folder == "sent"
                and isinstance(reference, tuple) and len(reference) == 2
                and reference[0] == "local-sent"
                and isinstance(reference[1], int)
                and 0 <= reference[1] < len(self.items)):
            if self.reply_button.isVisible():
                self.sentFollowUpRequested.emit(reference[1])
            return
        if (not self.local_mode or self.current_thread_mailbox not in self._mailboxes
                or not self.current_thread_id
                or self.selected_folder in ("sent", "drafts")):
            return
        self.replyRequested.emit(self.current_thread_mailbox, self.current_thread_id)

    def _request_forward(self):
        if (not self.local_mode or self.current_thread_mailbox not in self._mailboxes
                or not self.current_thread_id
                or self.selected_folder in ("sent", "drafts")):
            return
        self.forwardRequested.emit(
            self.current_thread_mailbox, self.current_thread_id)

    def show_reply_editor(self, mailbox, thread_id, recipient):
        if (mailbox != self.current_thread_mailbox
                or thread_id != self.current_thread_id
                or not isinstance(recipient, str) or "@" not in recipient):
            return False
        self.reply_target.setText("Reply to: " + recipient)
        self.reply_body.clear()
        self.reply_send.setText("Send reply…")
        self.reply_send.setEnabled(True)
        self.reply_editor.show()
        self.reply_body.setFocus()
        return True

    def show_followup_editor(self, index, recipient):
        current = self.thread_list.currentItem()
        reference = (current.data(Qt.ItemDataRole.UserRole)
                     if current is not None else None)
        if (not self.local_mode or self.selected_folder != "sent"
                or reference != ("local-sent", index)
                or not isinstance(recipient, str) or "@" not in recipient):
            return False
        self.reply_target.setText("New follow-up to: " + recipient)
        self.reply_body.clear()
        self.reply_send.setText("Send follow-up…")
        self.reply_send.setEnabled(True)
        self.reply_editor.show()
        self.reply_body.setFocus()
        return True

    def hide_reply_editor(self):
        self.reply_editor.hide()
        self.reply_send.setEnabled(True)
        self.reply_target.clear()

    def show_messages(self, mailbox, thread_id, messages):
        """Render only plain text; no HTML, resources or attachment downloads."""
        if (self.connection_state != "connected" or mailbox != self.current_thread_mailbox
                or thread_id != self.current_thread_id or not isinstance(messages, list)):
            return False
        self.body.setPlainText(
            format_mail_messages(messages) or "No messages in this conversation."
        )
        self.meta.setText("{} message(s) · Plain text".format(len(messages[:50])))
        self.reader_stack.setCurrentIndex(1)
        self.reply_button.setText("Reply")
        self.reply_button.setToolTip("Reply in this conversation")
        self.reply_button.setVisible(self.local_mode and bool(messages)
                                     and self.selected_folder not in ("sent","drafts"))
        self.forward_button.setVisible(self.local_mode and bool(messages)
                                       and self.selected_folder not in ("sent","drafts"))
        return True
