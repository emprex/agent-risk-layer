"""Native ENKYRON email inbox presentation; provider permissions stay server-side."""
from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QFrame, QHBoxLayout, QLabel, QLineEdit,
    QListWidget, QListWidgetItem, QPlainTextEdit, QPushButton, QSplitter,
    QVBoxLayout, QWidget,
)


class MailInboxView(QWidget):
    """Accessible inbox layout: account -> thread -> plain-text conversation."""

    mailboxChanged = Signal(str)
    refreshRequested = Signal(str)
    threadRequested = Signal(str, str)
    draftsRequested = Signal()
    deskRequested = Signal()
    newEmailRequested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.connection_state = "disconnected"
        self.current_thread_id = None
        self.current_thread_mailbox = None
        self.items = []
        self._mailboxes = {}
        self._build()

    def _build(self):
        root = QVBoxLayout(self)
        root.setContentsMargins(16, 16, 16, 14)
        root.setSpacing(12)

        title_row = QHBoxLayout()
        title = QLabel("Inbox")
        title.setObjectName("sectionTitle")
        title_row.addWidget(title)
        title_row.addStretch()
        self.new_email_button = QPushButton("New email")
        self.new_email_button.setObjectName("enkyronMailCompose")
        self.new_email_button.clicked.connect(lambda: self.newEmailRequested.emit())
        title_row.addWidget(self.new_email_button)
        root.addLayout(title_row)

        row = QHBoxLayout()
        row.addWidget(QLabel("Show"))
        self.account_picker = QComboBox()
        self.account_picker.setObjectName("enkyronMailAccountPicker")
        self.account_picker.setMinimumWidth(170)
        self.account_picker.setAccessibleName("Filter messages by email account")
        self.account_picker.setToolTip("All mail or one address")
        self.account_picker.currentIndexChanged.connect(self._account_changed)
        row.addWidget(self.account_picker)
        row.addStretch()
        self.refresh_button = QPushButton("Refresh")
        self.refresh_button.setObjectName("enkyronMailRefresh")
        self.refresh_button.setEnabled(False)
        self.refresh_button.setToolTip("Refresh the selected professional mailbox.")
        self.refresh_button.clicked.connect(self._refresh)
        row.addWidget(self.refresh_button)
        root.addLayout(row)

        self.connection_label = QLabel(
            "Email is offline. Connect the mail service to receive messages."
        )
        self.connection_label.setObjectName("enkyronMailConnectionStatus")
        self.connection_label.setTextFormat(Qt.TextFormat.PlainText)
        self.connection_label.setWordWrap(True)
        root.addWidget(self.connection_label)
        # These routes remain useful even without a Resend connection.
        quick = QHBoxLayout()
        self.local_drafts_button = QPushButton("Open local drafts")
        self.local_drafts_button.setObjectName("enkyronMailOpenDrafts")
        self.local_drafts_button.clicked.connect(lambda: self.draftsRequested.emit())
        quick.addWidget(self.local_drafts_button)
        self.client_desk_button = QPushButton("Open Client Desk")
        self.client_desk_button.setObjectName("enkyronMailOpenClientDesk")
        self.client_desk_button.clicked.connect(lambda: self.deskRequested.emit())
        quick.addWidget(self.client_desk_button)
        quick.addStretch()
        self.local_drafts_button.hide()
        self.client_desk_button.hide()
        root.addLayout(quick)

        self.splitter = QSplitter(Qt.Orientation.Horizontal)
        self.splitter.setChildrenCollapsible(False)
        self.splitter.setObjectName("enkyronMailSplitView")

        left = QFrame()
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(8, 8, 8, 8)
        left_layout.addWidget(QLabel("Messages"))
        self.search = QLineEdit()
        self.search.setObjectName("enkyronMailSearch")
        self.search.setAccessibleName("Search loaded conversations")
        self.search.setPlaceholderText("Search messages…")
        self.search.setMaxLength(120)
        self.search.setEnabled(False)
        self.search.textChanged.connect(self._filter)
        left_layout.addWidget(self.search)

        self.thread_list = QListWidget()
        self.thread_list.setObjectName("enkyronMailThreadList")
        self.thread_list.setAccessibleName("Conversations in selected mailbox")
        self.thread_list.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows
        )
        self.thread_list.currentItemChanged.connect(self._selected)
        left_layout.addWidget(self.thread_list, 1)
        self.count = QLabel("0 messages")
        self.count.setTextFormat(Qt.TextFormat.PlainText)
        left_layout.addWidget(self.count)
        self.splitter.addWidget(left)

        right = QFrame()
        right_layout = QVBoxLayout(right)
        right_layout.setContentsMargins(12, 8, 8, 8)
        self.subject = QLabel("Select a message")
        self.subject.setObjectName("enkyronMailSubject")
        self.subject.setTextFormat(Qt.TextFormat.PlainText)
        self.subject.setWordWrap(True)
        right_layout.addWidget(self.subject)
        self.meta = QLabel("")
        self.meta.setTextFormat(Qt.TextFormat.PlainText)
        self.meta.setWordWrap(True)
        right_layout.addWidget(self.meta)
        self.body = QPlainTextEdit()
        self.body.setObjectName("enkyronMailPlainTextPreview")
        self.body.setAccessibleName("Read-only conversation content")
        self.body.setReadOnly(True)
        self.body.setPlainText("")
        right_layout.addWidget(self.body, 1)
        actions = QHBoxLayout()
        self.reply_button = QPushButton("Reply")
        self.reply_button.setObjectName("enkyronMailReply")
        self.ticket_button = QPushButton("Create ticket")
        self.ticket_button.setObjectName("enkyronMailTicket")
        self.company_button = QPushButton("Link company")
        self.company_button.setObjectName("enkyronMailCompany")
        for button in (self.reply_button, self.ticket_button, self.company_button):
            button.setEnabled(False)
            button.setToolTip("Requires a verified message and an authenticated workflow.")
            actions.addWidget(button)
        actions.addStretch()
        right_layout.addLayout(actions)
        self.splitter.addWidget(right)
        self.splitter.setSizes([360, 700])
        root.addWidget(self.splitter, 1)

        # Technical integration notes do not belong in the everyday inbox.

    @property
    def selected_mailbox(self):
        return self.account_picker.currentData()

    def set_owner_mailboxes(self, card):
        """Use the existing Owner card for labels only, never as a login token."""
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
        """Presentation state only; this cannot grant authorization to Resend."""
        if state not in ("disconnected", "loading", "connected", "error"):
            raise ValueError("Invalid mail connection state")
        self.connection_state = state
        defaults = {
            "disconnected": "Email is offline. Connect the mail service to receive messages.",
            "loading": "Loading messages…",
            "connected": "",
            "error": "Unable to load messages. Try Refresh.",
        }
        self.connection_label.setText(str(explanation or defaults[state])[:180])
        self.connection_label.setVisible(state != "connected")
        active = state in ("connected", "error") and bool(self._mailboxes)
        self.refresh_button.setEnabled(active)
        self.search.setEnabled(state == "connected" and bool(self._mailboxes))
        if not active:
            self._clear_threads(
                "No messages yet." if state == "disconnected" else defaults[state]
            )

    def _clear_threads(self, explanation):
        self.current_thread_id = None
        self.current_thread_mailbox = None
        self.items = []
        self.thread_list.blockSignals(True)
        self.thread_list.clear()
        self.thread_list.blockSignals(False)
        self.search.clear()
        self.count.setText("0 messages")
        self.subject.setText("Select a message")
        self.meta.setText("")
        self.body.setPlainText(explanation)
        for b in (self.reply_button, self.ticket_button, self.company_button):
            b.setEnabled(False)

    def _account_changed(self, _index):
        self._clear_threads("No messages yet.")
        if self.selected_mailbox is not None:
            self.mailboxChanged.emit(self.selected_mailbox)

    def _refresh(self):
        if (self.connection_state in ("connected", "error")
                and (self.selected_mailbox in self._mailboxes
                     or self.selected_mailbox == "all")):
            self.refreshRequested.emit(self.selected_mailbox)

    def show_threads(self, mailbox, items, has_more=False):
        """Call only with data from trusted Owner-scoped backend, not the Qt IPC caller."""
        if self.connection_state != "connected" or mailbox != self.selected_mailbox:
            return False
        if not isinstance(items, list) or len(items) > 50:
            return False
        self._clear_threads("Select a conversation to read its messages.")
        self.items = list(items)
        self.thread_list.blockSignals(True)
        for item in items:
            if not isinstance(item, dict):
                continue
            thread_id = str(item.get("id") or "")
            if not thread_id or len(thread_id) > 100:
                continue
            subject = str(item.get("subject") or "(No subject)")[:300]
            date = str(item.get("last_message_at") or "")[:32]
            text = ("● " if item.get("unread") else "") + subject + ("\n" + date if date else "")
            row = QListWidgetItem(text)
            source = str(item.get("mailbox") or mailbox)
            if source not in self._mailboxes:
                continue
            row.setData(Qt.ItemDataRole.UserRole, (source, thread_id))
            self.thread_list.addItem(row)
        self.thread_list.blockSignals(False)
        count = self.thread_list.count()
        self.count.setText(
            "{} conversation(s){}.".format(count, " · More available" if has_more else "")
        )
        self._filter(self.search.text())
        return True

    def _filter(self, value):
        query = value.strip().casefold()
        shown = 0
        for i in range(self.thread_list.count()):
            item = self.thread_list.item(i)
            hidden = query not in item.text().casefold()
            item.setHidden(hidden)
            shown += not hidden
        if self.connection_state == "connected" and self.thread_list.count():
            self.count.setText("{} of {} conversation(s) shown.".format(
                shown, self.thread_list.count()
            ))

    def _selected(self, current, _previous):
        self.current_thread_id = None
        self.current_thread_mailbox = None
        self.subject.setText("Select a message")
        self.body.clear()
        self.meta.setText("Select a conversation to load its messages.")
        for b in (self.reply_button, self.ticket_button, self.company_button):
            b.setEnabled(False)
        if (not current or self.connection_state != "connected"
                or not self._mailboxes):
            return
        reference = current.data(Qt.ItemDataRole.UserRole)
        if not isinstance(reference, tuple) or len(reference) != 2:
            return
        source,thread_id = reference
        if source not in self._mailboxes:
            return
        self.current_thread_mailbox = source
        self.current_thread_id = thread_id
        self.subject.setText(current.text().split("\n", 1)[0].removeprefix("● "))
        self.body.setPlainText("Loading conversation…")
        self.threadRequested.emit(source, thread_id)

    def show_messages(self, mailbox, thread_id, messages):
        """Render text only. External links and embedded images are never loaded."""
        if (self.connection_state != "connected" or mailbox != self.current_thread_mailbox
                or thread_id != self.current_thread_id or not isinstance(messages, list)):
            return False
        view = []
        for item in messages[:50]:
            if not isinstance(item, dict):
                continue
            recipients = item.get("to") if isinstance(item.get("to"), list) else []
            header = "From: {}\nTo: {}\nDate: {}\nSubject: {}".format(
                str(item.get("from") or "")[:254],
                ", ".join(map(str, recipients[:20]))[:500],
                str(item.get("created_at") or "")[:64],
                str(item.get("subject") or "")[:300],
            )
            message = str(item.get("text") or "")[:20000]
            if not message and item.get("html_only"):
                message = "[HTML-only message: safe text preview not available]"
            view.append(header + "\n\n" + message)
        self.body.setPlainText(
            ("\n\n" + ("─" * 30) + "\n\n").join(view)
            if view else "No messages in this thread."
        )
        self.meta.setText("{} message(s) · Plain text only.".format(len(view)))
        # Reply, ticket and company actions stay disabled until a separate
        # authenticated, auditable workflow is wired. A displayed message is
        # not proof of the sender identity or permission to contact them.
        return True
