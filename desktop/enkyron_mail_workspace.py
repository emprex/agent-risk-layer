"""Native ENKYRON Inbox: clean list/detail mail experience, provider read-only.

All data remains text-only. Mailbox permissions and Resend access are handled
by the backend; this presentation creates no authenticated actions or sends.
"""
from datetime import datetime

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QFrame, QHBoxLayout, QLabel, QLineEdit,
    QListWidget, QListWidgetItem, QPlainTextEdit, QPushButton, QSplitter,
    QStackedWidget, QVBoxLayout, QWidget,
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
    refreshRequested = Signal(str)
    threadRequested = Signal(str, str)
    threadOpenRequested = Signal(str, str)
    draftsRequested = Signal()
    deskRequested = Signal()
    newEmailRequested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.connection_state = "disconnected"
        self.current_thread_id = None
        self.current_thread_mailbox = None
        self.items = []
        self._has_more = False
        self._mailboxes = {}
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
        self.search = QLineEdit()
        self.search.setObjectName("enkyronMailSearch")
        self.search.setPlaceholderText("Search loaded conversations…")
        self.search.setAccessibleName("Search loaded conversations")
        self.search.setMaxLength(120)
        self.search.setEnabled(False)
        self.search.textChanged.connect(self._filter)
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
        self.local_drafts_button = QPushButton("Open local drafts")
        self.local_drafts_button.setObjectName("enkyronMailOpenDrafts")
        self.local_drafts_button.clicked.connect(self.draftsRequested.emit)
        self.local_drafts_button.hide()
        self.client_desk_button = QPushButton("Open Client Desk")
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
        left_layout.addWidget(self.thread_list, 1)
        self.splitter.addWidget(left)

        self.reader_stack = QStackedWidget()
        self.reader_stack.setObjectName("enkyronMailReaderStack")
        choose_page = QWidget()
        choose_layout = QVBoxLayout(choose_page)
        choose_layout.addStretch()
        choose_text = QLabel("Select a conversation to read it")
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
        self.reader_stack.addWidget(right)
        self.reader_stack.setCurrentIndex(0)
        self.splitter.addWidget(self.reader_stack)
        self.splitter.setSizes([440, 720])
        self.mail_stack.addWidget(self.splitter)
        root.addWidget(self.mail_stack, 1)

        # No inert Reply, Create ticket or Link company buttons: those workflows
        # are not authenticated/implemented. Their absence is deliberate.
        self._show_empty("Inbox is empty", "No messages yet.")

    @property
    def selected_mailbox(self):
        return self.account_picker.currentData()

    def _show_empty(self, title, detail):
        self.empty_title.setText(title)
        self.empty_explanation.setText(detail)
        self.mail_stack.setCurrentIndex(0)

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
        if {key for key, _ in validated} != {"direction", "support") or len(validated) != 2:
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
        if not active:
            self._clear_threads(defaults[state])

    def _clear_threads(self, explanation):
        self.current_thread_id = None
        self.current_thread_mailbox = None
        self.items = []
        self._has_more = False
        self.thread_list.blockSignals(True)
        self.thread_list.clear()
        self.thread_list.blockSignals(False)
        self.search.blockSignals(True)
        self.search.clear()
        self.search.blockSignals(False)
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

    def _refresh(self):
        if (self.connection_state in ("connected", "error")
                and (self.selected_mailbox in self._mailboxes
                     or self.selected_mailbox == "all")):
            self.refreshRequested.emit(self.selected_mailbox)

    def show_threads(self, mailbox, items, has_more=False):
        """Provider-scoped, bounded plain-text thread listing."""
        if self.connection_state != "connected" or mailbox != self.selected_mailbox:
            return False
        if not isinstance(items, list) or len(items) > 50:
            return False
        self._clear_threads("No conversations in this inbox.")
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
            label = ("● " if unread else "") + subject + ("\n" + date if date else "")
            entry = QListWidgetItem(label)
            entry.setData(Qt.ItemDataRole.UserRole, (source, thread_id))
            entry.setToolTip(subject + ("\n" + date if date else ""))
            if unread:
                font = QFont(entry.font())
                font.setBold(True)
                entry.setFont(font)
            self.thread_list.addItem(entry)
        self.thread_list.blockSignals(False)
        count = self.thread_list.count()
        self.count.setText(
            "{} conversation(s){}.".format(count, " · More available" if has_more else "")
        )
        self._filter(self.search.text())
        return True

    def _filter(self, value):
        query = value.strip().casefold()
        visible = 0
        for index in range(self.thread_list.count()):
            item = self.thread_list.item(index)
            hidden = query not in item.text().casefold()
            item.setHidden(hidden)
            visible += not hidden
        total = self.thread_list.count()
        summary = (
            "{} of {} conversations".format(visible, total)
            if query else "{} conversation(s)".format(total)
        )
        self.count.setText(
            summary + (" · more on provider" if self._has_more else "")
        )
        selected = self.thread_list.currentItem()
        if selected is not None and selected.isHidden():
            self.thread_list.setCurrentRow(-1)
        if self.connection_state != "connected":
            return
        if total == 0:
            self._show_empty("Inbox is empty",
                "No conversations in this mailbox. New messages will appear here.")
        elif visible == 0:
            self._show_empty("No matching conversations",
                "Try a different search term.")
        else:
            self.mail_stack.setCurrentIndex(1)

    def _selected(self, current, _previous):
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
        if source not in self._mailboxes:
            return
        self.current_thread_mailbox = source
        self.current_thread_id = thread_id
        self.subject.setText(current.text().split("\n", 1)[0].removeprefix("● "))
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
        if source in self._mailboxes:
            self.threadOpenRequested.emit(source, thread_id)

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
        return True
