"""Native ENKYRON Inbox: clean list/detail mail experience, provider read-only.

All data remains text-only. Mailbox permissions and Resend access are handled
by the backend; this presentation creates no authenticated actions or sends.
"""
from datetime import datetime
from html import escape

from PySide6.QtCore import Qt, Signal, QBuffer, QByteArray, QIODevice
from PySide6.QtGui import QFont, QImageReader, QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QFrame, QHBoxLayout, QLabel, QLineEdit,
    QListWidget, QListWidgetItem, QMenu, QPlainTextEdit, QPushButton, QSplitter,
    QStackedWidget, QVBoxLayout, QWidget, QTreeWidget, QTreeWidgetItem, QInputDialog,
    QTextBrowser, QMessageBox, QScrollArea, QCheckBox,
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
        if item.get("preview_truncated") is True:
            body += ("\n\n[PREVIEW ONLY: full original text is stored in "
                     "NEMORYTH. This pane shows at most 20,000 characters.]")
        if item.get("archive_state") == "incomplete":
            body += "\n\n[ARCHIVE INCOMPLETE: verify provider source.]"
        try:
            quarantined = int(item.get("attachment_count") or 0)
        except (ValueError, TypeError):
            quarantined = 0
        if quarantined > 0:
            body += ("\n\n[{} attachment reference(s) quarantined in "
                     "NEMORYTH: file contents are NOT stored or approved "
                     "for opening yet.]").format(quarantined)
        parts.append(header + "\n\n" + body)
    return ("\n\n" + ("─" * 30) + "\n\n").join(parts)


def _safe_sender_label(sender):
    """Prefer a readable display name; keep the full address in the tooltip."""
    raw = str(sender or "").strip()
    if "<" in raw and raw.endswith(">"):
        name = raw.rsplit("<", 1)[0].strip().strip('"')
        if name:
            return name[:55]
    return raw[:52] + ("…" if len(raw) > 52 else "")


def format_mail_message_cards(messages):
    """Only OUR generated HTML. Provider HTML/URLs are never interpreted.

    All external fields are escaped. No img, anchor, remote CSS, file URL,
    JavaScript or raw attachment content can reach the QTextBrowser.
    """
    if not isinstance(messages, list):
        return ""
    cards = []
    for index, item in enumerate(messages[:50], start=1):
        if not isinstance(item, dict):
            continue
        def safe(value, size):
            return escape(str(value or "")[:size], quote=True)
        sender = safe(item.get("from"), 254) or "Unknown sender"
        to = item.get("to") if isinstance(item.get("to"), list) else []
        recipient = safe(", ".join(str(x) for x in to[:20]), 500)
        sent = safe(_display_date(item.get("created_at")), 80)
        subject = safe(item.get("subject") or "(No subject)", 300)
        plain = str(item.get("text") or "")[:20000]
        if not plain and item.get("html_only"):
            plain = "[HTML-only message: safe text preview unavailable]"
        body = escape(plain, quote=True).replace("\r\n", "\n").replace(
            "\r", "\n").replace("\n", "<br>")
        notices = []
        if item.get("preview_truncated") is True:
            notices.append("Preview only — complete body stored in NEMORYTH; "
                           "showing the first 20,000 characters")
        if item.get("archive_state") == "incomplete":
            notices.append("Archive incomplete — source verification required")
        try:
            attachments = max(0, int(item.get("attachment_count") or 0))
        except (TypeError, ValueError):
            attachments = 0
        if attachments:
            notices.append("{} attachment reference(s) — file contents "
                           "not approved for opening".format(attachments))
        # Only manifest metadata is presented. No download button or file URL.
        attachment_lines = []
        refs = item.get("attachment_previews")
        if isinstance(refs, list):
            for ref_index, detail in enumerate(refs[:8]):
                if not isinstance(detail, dict):
                    continue
                filename = escape(str(detail.get("filename") or
                                      "Unnamed attachment")[:120], quote=True)
                try:
                    size = int(detail.get("size"))
                except (TypeError, ValueError):
                    size = -1
                display_size = (" · {} bytes".format(size)
                                if 0 <= size <= 26214400 else "")
                stage = str(detail.get("state") or "metadata_only")
                state_label = ("Binary stored in quarantine — NOT scanned"
                               if stage == "quarantined_unscanned"
                               else "Blocked" if stage == "blocked"
                               else "Metadata only — file NOT downloaded")
                display_name = filename
                if filename.lower().endswith((".md", ".txt", ".pdf", ".png", ".jpg", ".jpeg")):
                    display_name = (
                        '<a href="enkyron-attachment:{}:{}" '
                        'style="color:#176e81;text-decoration:underline;">'
                        .format(index-1, ref_index) + filename + '</a>'
                    )
                attachment_lines.append(
                    "<p style='margin:2px 0;color:#536c80;'>"
                    + display_name + escape(display_size, quote=True)
                    + " · " + escape(state_label, quote=True) + "</p>")
        notes = "".join(
            "<p style='color:#785e28;background-color:#fff8e6;"
            "padding:6px;border:1px solid #ead9af;'>"
            + escape(n, quote=True) + "</p>" for n in notices
        )
        cards.append(
            "<table width='100%' cellspacing='0' cellpadding='0' "
            "style='border:1px solid #d6e2eb;background-color:#ffffff;'>"
            "<tr><td style='background-color:#edf4f8;"
            "padding:10px 12px;border-bottom:1px solid #d6e2eb;'>"
            "<b>" + sender + "</b>"
            "<p style='color:#536c80;margin:3px 0;'>"
            + ("To: " + recipient + " · " if recipient else "")
            + sent + "</p><span style='color:#334f63;'>"
            + subject + "</span></td></tr>"
            "<tr><td style='padding:12px 14px;'>"
            "<p style='margin:0;white-space:pre-wrap;'>"
            + body + "</p>" + notes + "".join(attachment_lines)
            + "</td></tr></table>"
            "<p style='margin:0 0 12px 0;'>&nbsp;</p>"
        )
    return "<html><body style='font-family:DejaVu Sans;font-size:12px;" + (
        "background-color:#f7fafc;color:#20354a;'>" +
        "".join(cards) + "</body></html>"
    ) if cards else ""


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
    localRecordMoveRequested = Signal(str, int, str)
    filedRecordMoveRequested = Signal(str, str, str)
    filedRecordOpenRequested = Signal(str)
    localTrashClearRequested = Signal()
    replyRequested = Signal(str, str)
    forwardRequested = Signal(str, str)
    fullTextRequested = Signal(str, str, str)
    localCompanyLinkRequested = Signal(str, str)
    localTicketLinkRequested = Signal(str, str)
    attachmentRequested = Signal(str, str)
    attachmentOpenRequested = Signal(str, str, str, str, int)
    attachmentSaveRequested = Signal(str, str, str, str, int)
    replySubmitRequested = Signal()
    replyAddPeopleRequested = Signal()
    replyPreviewRequested = Signal()
    sentFollowUpRequested = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.connection_state = "disconnected"
        self.current_thread_id = None
        self.current_thread_mailbox = None
        self.items = []
        self._filed_records = []
        self._has_more = False
        self._local_page = 0
        self._local_search_query = None
        self._mailboxes = {}
        self._filing_mailboxes = set()
        self._folder = 'inbox'
        self.local_mode = False
        self.local_folders = []
        self.local_labels = []
        self._filed_records = []
        self._full_text_options = []
        self._accepted_mailbox = None
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
        self.empty_trash_button = QPushButton("Empty Trash…")
        self.empty_trash_button.setObjectName("enkyronMailEmptyTrash")
        self.empty_trash_button.setToolTip(
            "Clear local Trash after confirmation; retain provider and audit records"
        )
        self.empty_trash_button.clicked.connect(self.localTrashClearRequested.emit)
        self.empty_trash_button.hide()
        list_heading.addWidget(self.empty_trash_button)
        left_layout.addLayout(list_heading)
        self.thread_list = QListWidget()
        self.thread_list.setObjectName("enkyronMailThreadList")
        self.thread_list.setAccessibleName("Conversations in selected mailbox")
        self.thread_list.setWordWrap(True)
        self.thread_list.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
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
        self.body = QTextBrowser()
        self.body.setObjectName("enkyronMailPlainTextPreview")
        self.body.setAccessibleName("Read-only conversation; external links disabled")
        self.body.setOpenExternalLinks(False)
        self.body.setOpenLinks(False)
        self.body.anchorClicked.connect(self._inline_attachment_clicked)
        self.body.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.body.customContextMenuRequested.connect(
            self._attachment_context_menu)
        self.body.setReadOnly(True)
        self.body.setPlainText("")
        right_layout.addWidget(self.body, 1)
        self.attachment_image_scroll = QScrollArea()
        self.attachment_image_scroll.setWidgetResizable(True)
        self.attachment_image_label = QLabel()
        self.attachment_image_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.attachment_image_scroll.setWidget(self.attachment_image_label)
        right_layout.addWidget(self.attachment_image_scroll, 1)
        self.attachment_image_scroll.hide()
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
        self.full_text_button = QPushButton("Read full text…")
        self.full_text_button.setObjectName("enkyronMailReadFullText")
        self.full_text_button.setToolTip(
            "Open complete saved plain text from NEMORYTH (never provider HTML)")
        self.full_text_button.clicked.connect(self._request_full_text)
        self.full_text_button.hide()
        reply_toolbar.addWidget(self.full_text_button)
        self.crm_link_button = QPushButton("Link to CRM…")
        self.crm_link_button.setObjectName("enkyronMailLinkCRM")
        self.crm_link_button.setToolTip(
            "Explicitly associate this saved conversation with one existing CRM company")
        self.crm_link_button.clicked.connect(self._request_company_link)
        self.crm_link_button.hide()
        reply_toolbar.addWidget(self.crm_link_button)
        self.ticket_link_button = QPushButton("Link to Ticket…")
        self.ticket_link_button.setObjectName("enkyronMailLinkTicket")
        self.ticket_link_button.setToolTip(
            "Explicitly associate this saved conversation with an existing Client Desk ticket")
        self.ticket_link_button.clicked.connect(self._request_ticket_link)
        self.ticket_link_button.hide()
        reply_toolbar.addWidget(self.ticket_link_button)
        self.document_dossier_button = QPushButton("Save to dossier…")
        self.document_dossier_button.setObjectName(
            "enkyronMailSaveToDossier"
        )
        self.document_dossier_button.hide()
        reply_toolbar.addWidget(self.document_dossier_button)
        self.attachment_button = QPushButton("Attachments…")
        self.attachment_button.setObjectName("enkyronMailAttachments")
        self.attachment_button.clicked.connect(self._request_attachments)
        self.attachment_button.hide()
        reply_toolbar.addWidget(self.attachment_button)
        self.attachment_button.hide()
        self.attachment_back_button = QPushButton("← Back to email")
        self.attachment_back_button.setObjectName("enkyronMailBackFromAttachment")
        self.attachment_back_button.clicked.connect(self._back_from_attachment)
        self.attachment_back_button.hide()
        reply_toolbar.addWidget(self.attachment_back_button)
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
        self.reply_people_panel = QFrame()
        people_layout = QVBoxLayout(self.reply_people_panel)
        people_layout.setContentsMargins(0, 0, 0, 0)
        cc_row = QHBoxLayout()
        cc_row.addWidget(QLabel("CC"))
        self.reply_cc = QLineEdit()
        self.reply_cc.setObjectName("enkyronReplyExtraCc")
        self.reply_cc.setMaxLength(12000)
        self.reply_cc.setPlaceholderText(
            "Additional CC addresses, separated by commas"
        )
        cc_row.addWidget(self.reply_cc, 1)
        people_layout.addLayout(cc_row)
        bcc_row = QHBoxLayout()
        bcc_row.addWidget(QLabel("BCC"))
        self.reply_bcc = QLineEdit()
        self.reply_bcc.setObjectName("enkyronReplyExtraBcc")
        self.reply_bcc.setMaxLength(12000)
        self.reply_bcc.setPlaceholderText(
            "Additional private BCC addresses"
        )
        bcc_row.addWidget(self.reply_bcc, 1)
        people_layout.addLayout(bcc_row)
        self.reply_people_panel.hide()
        reply_layout.addWidget(self.reply_people_panel)
        self.reply_body = QPlainTextEdit()
        self.reply_body.setObjectName("enkyronMailReplyBody")
        self.reply_body.setPlaceholderText("Write your reply…")
        self.reply_body.setMinimumHeight(130)
        reply_layout.addWidget(self.reply_body)
        reply_actions = QHBoxLayout()
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self.cancel_reply_editor)
        reply_actions.addWidget(cancel)
        self.reply_add_people = QPushButton("Add people…")
        self.reply_add_people.setObjectName("enkyronReplyAddPeople")
        self.reply_add_people.setToolTip(
            "Prepare a separate unsent draft with more participants"
        )
        self.reply_add_people.clicked.connect(
            self.toggle_reply_participants
        )
        self.reply_add_people.hide()
        reply_actions.addWidget(self.reply_add_people)
        self.reply_all_toggle = QCheckBox("Include visible participants")
        self.reply_all_toggle.setObjectName("enkyronReplyAll")
        self.reply_all_toggle.setToolTip(
            "Include only participants visible in Resend To/CC. "
            "Other original To recipients may not be available."
        )
        reply_actions.addWidget(self.reply_all_toggle)
        self.reply_preview = QPushButton("Review recipients…")
        self.reply_preview.setObjectName(
            "enkyronReplyPreviewRecipients"
        )
        self.reply_preview.clicked.connect(
            lambda _checked=False:
            self.replyPreviewRequested.emit()
        )
        reply_actions.addWidget(self.reply_preview)
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
        if folder and folder.get("key") == "trash":
            menu = QMenu(self)
            clear = menu.addAction("Empty Trash (local view; audit retained)…")
            selected = menu.exec(self.folder_tree.viewport().mapToGlobal(pos))
            if selected == clear:
                self.localTrashClearRequested.emit()
            return
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

    def _restore_local_folder_selection(self):
        if not self.local_mode:
            return
        for row in range(self.folder_tree.topLevelItemCount()):
            item = self.folder_tree.topLevelItem(row)
            if item.data(0, Qt.ItemDataRole.UserRole) == self._folder:
                self.folder_tree.blockSignals(True)
                self.folder_tree.setCurrentItem(item)
                self.folder_tree.blockSignals(False)
                break

    def activate_local_folder(self, folder):
        """Navigate with one folder tree, with no secondary Sent/Drafts pages."""
        if not self.local_mode or not isinstance(folder, str):
            return
        keys = {f.get("key") for f in self.local_folders if isinstance(f, dict)}
        if folder not in keys:
            self._restore_local_folder_selection()
            return
        if folder == self._folder:
            return
        if not self._confirm_inline_reply_discard():
            self._restore_local_folder_selection()
            return
        self._folder = folder
        self.empty_trash_button.setVisible(folder == "trash")
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
        if mailbox == "filed-record":
            records = self._filed_records
            if not isinstance(thread_id, int) or not 0 <= thread_id < len(records):
                return
            entry = records[thread_id]
            original = entry.get("original_kind")
            draft_id = entry.get("draft_id")
            if original not in ("sent", "drafts") or not isinstance(draft_id, str):
                return
            menu = QMenu(self)
            open_action = menu.addAction("Open saved message")
            open_action.triggered.connect(
                lambda _checked=False: self.filedRecordOpenRequested.emit(draft_id)
            )
            menu.addSeparator()
            if self._folder != original:
                restore = menu.addAction("Restore to " + original.title())
                restore.triggered.connect(
                    lambda _checked=False:
                    self.filedRecordMoveRequested.emit(draft_id, self._folder, original)
                )
            if self._folder != "trash":
                trash = menu.addAction("Move to Trash")
                trash.triggered.connect(
                    lambda _checked=False:
                    self.filedRecordMoveRequested.emit(draft_id, self._folder, "trash")
                )
            if self._folder not in ("archive", "trash"):
                archive = menu.addAction("Archive")
                archive.triggered.connect(
                    lambda _checked=False:
                    self.filedRecordMoveRequested.emit(draft_id, self._folder, "archive")
                )
            move = menu.addMenu("Move to folder")
            for target in ("archive", "spam", "trash"):
                if target == self._folder:
                    continue
                action = move.addAction(target.title())
                action.triggered.connect(
                    lambda _checked=False, destination=target:
                    self.filedRecordMoveRequested.emit(draft_id, self._folder, destination)
                )
            if self._folder == "trash":
                menu.addSeparator()
                clear = menu.addAction("Empty Trash…")
                clear.triggered.connect(self.localTrashClearRequested.emit)
            menu.exec(self.thread_list.mapToGlobal(pos))
            return
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
            menu.addSeparator()
            trash = menu.addAction("Move to Trash")
            trash.triggered.connect(
                lambda _checked=False: self.localRecordMoveRequested.emit(
                    mailbox.removeprefix("local-"), thread_id, "trash"
                )
            )
            archive = menu.addAction("Archive")
            archive.triggered.connect(
                lambda _checked=False: self.localRecordMoveRequested.emit(
                    mailbox.removeprefix("local-"), thread_id, "archive"
                )
            )
            move = menu.addMenu("Move to folder")
            for target in ("archive", "spam", "trash"):
                action = move.addAction(target.title())
                action.triggered.connect(
                    lambda _checked=False, destination=target:
                    self.localRecordMoveRequested.emit(
                        mailbox.removeprefix("local-"), thread_id, destination
                    )
                )
            menu.exec(self.thread_list.mapToGlobal(pos))
            return
        if mailbox not in self._mailboxes:
            return
        menu = QMenu(self)
        open_action = menu.addAction("Open message")
        open_action.triggered.connect(
            lambda _checked=False:
            self.threadOpenRequested.emit(mailbox, thread_id)
        )
        if self._folder == "inbox":
            reply_action = menu.addAction("Reply")
            reply_action.triggered.connect(
                lambda _checked=False:
                self.replyRequested.emit(mailbox, thread_id)
            )
        menu.addSeparator()
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
        if self._folder in ("trash", "archive", "spam"):
            restore = menu.addAction("Restore to Inbox")
            restore.triggered.connect(
                lambda _checked=False:
                self.localMoveRequested.emit(mailbox, thread_id, "inbox")
            )
        if self._folder == "trash":
            clear = menu.addAction("Empty Trash…")
            clear.triggered.connect(self.localTrashClearRequested.emit)
        else:
            trash = menu.addAction("Move to Trash")
            trash.triggered.connect(
                lambda _checked=False:
                self.localMoveRequested.emit(mailbox, thread_id, "trash")
            )
            if self._folder != "archive":
                archive = menu.addAction("Archive")
                archive.triggered.connect(
                    lambda _checked=False:
                    self.localMoveRequested.emit(mailbox, thread_id, "archive")
                )
        move = menu.addMenu("Move to folder")
        actual_folder = (
            entry.get("folder_key") if isinstance(entry, dict) else None
        ) or self._folder
        for folder in self.local_folders:
            key = folder.get("key")
            if key in ("sent", "drafts", actual_folder, "hidden"):
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
        self._accepted_mailbox = self.selected_mailbox
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
        self.full_text_button.hide()
        self.crm_link_button.hide()
        self.ticket_link_button.hide()
        self.attachment_button.hide()
        self.attachment_back_button.hide()
        self.attachment_image_label.clear()
        self.attachment_image_scroll.hide()
        self.body.show()
        self._attachment_previous = None
        self._attachment_snapshot = []
        self.crm_link_button.setEnabled(True)
        self.crm_link_button.setText("Link to CRM…")
        self._full_text_options = []
        self.current_thread_id = None
        self.current_thread_mailbox = None
        self.items = []
        self._filed_records = []
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
        if (self.selected_mailbox != self._accepted_mailbox
                and not self._confirm_inline_reply_discard()):
            index = self.account_picker.findData(self._accepted_mailbox)
            self.account_picker.blockSignals(True)
            self.account_picker.setCurrentIndex(index)
            self.account_picker.blockSignals(False)
            return
        self._accepted_mailbox = self.selected_mailbox
        self._clear_threads("No messages yet.")
        if self.selected_mailbox is not None:
            self.mailboxChanged.emit(self.selected_mailbox)

    def _folder_changed(self, _index):
        folder = self.selected_folder
        if folder not in ('inbox','archive','spam','trash'):
            return
        if folder != self._folder and not self._confirm_inline_reply_discard():
            old = self.folder_picker.findData(self._folder)
            self.folder_picker.blockSignals(True)
            self.folder_picker.setCurrentIndex(old)
            self.folder_picker.blockSignals(False)
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
            # Manual Send / Receive may rebuild the message list. It must not
            # silently destroy a reply in the inline editor.
            if not self._confirm_inline_reply_discard():
                return
            self.hide_reply_editor()
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
                    and page == 0 and self._local_page == 0
                    and not self.search.text().strip()
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
                full_sender = str(item.get("sender") or "").strip()
                if full_sender:
                    label = ("● " if unread else "") + _safe_sender_label(full_sender) + "\n" + subject
                if item.get("flagged") is True:
                    label = "★ " + label.removeprefix("★ ")
                tags = str(item.get("labels") or "").strip()
                if tags:
                    label += "   [" + tags[:80] + "]"
            label += ("\n" + date if date else "")
            entry = QListWidgetItem(label)
            entry.setData(Qt.ItemDataRole.UserRole, (source, thread_id))
            full_sender = str(item.get("sender") or "") if self.local_mode else ""
            entry.setToolTip((full_sender + "\n" if full_sender else "")
                             + subject + ("\n" + date if date else ""))
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
        self._clear_threads(
            "No messages in this folder.",
            preserve_search=bool(self.search.text().strip()))
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

    def append_filed_records(self, folder, records):
        """Show locally filed Sent/Drafts alongside cached conversations."""
        if not self.local_mode or folder != self._folder or folder not in (
                "archive", "spam", "trash"):
            return False
        if not isinstance(records, list):
            return False
        self._filed_records = list(records[:100])
        self.thread_list.blockSignals(True)
        for index, record in enumerate(self._filed_records):
            if not isinstance(record, dict):
                continue
            if (self.selected_mailbox != "all"
                    and record.get("mailbox_key") != self.selected_mailbox):
                continue
            label = "{} · {}\n{}\n{}".format(
                (record.get("original_kind") or "Saved").title(),
                str(record.get("recipient_email") or "Recipient not set")[:100],
                str(record.get("subject") or "(No subject)")[:300],
                "Locally filed record — provider unchanged"
            )
            item = QListWidgetItem(label)
            item.setData(Qt.ItemDataRole.UserRole, ("filed-record", index))
            item.setToolTip("Right-click to move or restore this saved record")
            self.thread_list.addItem(item)
        self.thread_list.blockSignals(False)
        self.count.setText("{} conversation(s) / filed record(s)".format(
            self.thread_list.count()))
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

    def show_local_sent_conversation(
            self, index, mailbox, thread_id, messages):
        """Complete Sent conversation without changing the selected folder."""
        selected = self.thread_list.currentItem()
        if (not self.local_mode or self.selected_folder != "sent"
                or selected is None
                or selected.data(Qt.ItemDataRole.UserRole) != ("local-sent", index)
                or mailbox not in self._mailboxes
                or not isinstance(thread_id, str) or len(thread_id) != 36
                or not isinstance(messages, list) or len(messages) < 2):
            return False

        self.current_thread_mailbox = mailbox
        self.current_thread_id = thread_id
        self._attachment_snapshot = messages[:50]
        self._attachment_previous = None
        self.attachment_back_button.hide()
        self.attachment_image_label.clear()
        self.attachment_image_scroll.hide()
        self.body.show()
        self.body.setHtml(format_mail_message_cards(messages))
        self.meta.setText(
            "{} messages · Sent + Inbox · Verified conversation".format(
                len(messages[:50]))
        )
        self.reader_stack.setCurrentIndex(1)
        return True

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
            # Executing a server search reloads the current thread list; a
            # typed inline reply is still UNSAVED until its submission.
            if not self._confirm_inline_reply_discard():
                return
            self.hide_reply_editor()
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
        if (current is not _previous and
                not self._confirm_inline_reply_discard()):
            # Qt reports selection AFTER moving to the new item. Restore the
            # previous reader without emitting a second selection event.
            self.thread_list.blockSignals(True)
            if _previous is not None:
                self.thread_list.setCurrentItem(_previous)
            else:
                self.thread_list.setCurrentRow(-1)
            self.thread_list.blockSignals(False)
            return
        self.hide_reply_editor()
        self.reply_button.hide()
        self.forward_button.hide()
        self.full_text_button.hide()
        self.crm_link_button.hide()
        self.ticket_link_button.hide()
        self.attachment_button.hide()
        self.attachment_back_button.hide()
        self.attachment_image_label.clear()
        self.attachment_image_scroll.hide()
        self.body.show()
        self._attachment_previous = None
        self._attachment_snapshot = []
        self.crm_link_button.setEnabled(True)
        self.crm_link_button.setText("Link to CRM…")
        self._full_text_options = []
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
        if self.local_mode and source == "filed-record":
            if not isinstance(thread_id, int) or not 0 <= thread_id < len(self._filed_records):
                return
            record = self._filed_records[thread_id]
            self.subject.setText(str(record.get("subject") or "(No subject)")[:300])
            self.meta.setText("Locally filed " + str(record.get("original_kind") or "email"))
            self.body.setPlainText(
                "Open this saved message by double-clicking or right-clicking. "
                "Moving it never changes provider delivery or CRM audit records."
            )
            self.reader_stack.setCurrentIndex(1)
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
        elif self.local_mode and source == "filed-record":
            if isinstance(thread_id, int) and 0 <= thread_id < len(self._filed_records):
                draft_id = self._filed_records[thread_id].get("draft_id")
                if isinstance(draft_id, str):
                    self.filedRecordOpenRequested.emit(draft_id)
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

    def _request_company_link(self):
        if (not self.local_mode or self.current_thread_mailbox not in self._mailboxes
                or not self.current_thread_id or self.selected_folder in
                ("sent", "drafts", "spam", "trash")
                or self.crm_link_button.isHidden()
                or not self.crm_link_button.isEnabled()):
            return
        self.localCompanyLinkRequested.emit(
            self.current_thread_mailbox, self.current_thread_id)

    def _inline_attachment_clicked(self, url):
        # Only internal generated references; never open external URLs.
        parts = url.toString().split(":")
        if (len(parts) != 3 or parts[0] != "enkyron-attachment"
                or not parts[1].isdigit() or not parts[2].isdigit()):
            return
        midx, aidx = int(parts[1]), int(parts[2])
        messages = getattr(self, "_attachment_snapshot", [])
        if (not self.local_mode or not self.current_thread_id
                or self.current_thread_mailbox not in self._mailboxes
                or not 0 <= midx < len(messages) or not 0 <= aidx < 8):
            return
        message = messages[midx]
        if not isinstance(message, dict):
            return
        refs = message.get("attachment_previews")
        if not isinstance(refs, list) or aidx >= len(refs):
            return
        ref = refs[aidx]
        if not isinstance(ref, dict):
            return
        filename = str(ref.get("filename") or "")
        message_id = message.get("id")
        try:
            size = int(ref.get("size"))
        except (ValueError, TypeError):
            return
        ext = filename.lower().rsplit(".", 1)[-1]
        limit = (1048576 if ext in ("md", "txt") else
                 10485760 if ext in ("pdf", "png", "jpg", "jpeg") else -1)
        if (limit < 0 or not isinstance(message_id, str)
                or len(message_id) != 36 or not 0 <= size <= limit):
            return
        self.attachmentOpenRequested.emit(
            self.current_thread_mailbox, self.current_thread_id,
            message_id, filename, size)

    def _attachment_context_menu(self, pos):
        """Ordinary text context menu, plus Save As on an attachment link."""
        menu = self.body.createStandardContextMenu()
        try:
            parts = self.body.anchorAt(pos).split(":")
            if (len(parts) == 3
                    and parts[0] == "enkyron-attachment"
                    and parts[1].isdigit() and parts[2].isdigit()
                    and self.local_mode
                    and self.current_thread_mailbox in self._mailboxes
                    and self.current_thread_id):
                midx, aidx = int(parts[1]), int(parts[2])
                messages = getattr(self, "_attachment_snapshot", [])
                if 0 <= midx < len(messages) and 0 <= aidx < 8:
                    message = messages[midx]
                    refs = message.get("attachment_previews", [])
                    if isinstance(refs, list) and aidx < len(refs):
                        ref = refs[aidx]
                        name = str(ref.get("filename") or "")
                        size = int(ref.get("size"))
                        message_id = str(message.get("id") or "")
                        if (name.lower().endswith((".md", ".txt", ".pdf", ".png", ".jpg", ".jpeg"))
                                and len(message_id) == 36
                                and 0 <= size <= (1048576 if name.lower().endswith((".md", ".txt")) else 10485760)):
                            menu.addSeparator()
                            save = menu.addAction("Save As…")
                            mailbox = self.current_thread_mailbox
                            thread_id = self.current_thread_id
                            save.triggered.connect(
                                lambda checked=False:
                                self.attachmentSaveRequested.emit(
                                    mailbox, thread_id,
                                    message_id, name, size))
        except (TypeError, ValueError, KeyError, AttributeError):
            pass
        menu.exec(self.body.mapToGlobal(pos))

    def show_attachment_image_inline(self, filename, raw):
        """Display PNG/JPEG in the existing reading pane."""
        if not isinstance(raw, bytes) or len(raw) > 10485760:
            return False

        buffer = QBuffer()
        buffer.setData(QByteArray(raw))
        if not buffer.open(QIODevice.OpenModeFlag.ReadOnly):
            return False

        reader = QImageReader(buffer)
        reader.setAutoTransform(True)
        dimensions = reader.size()

        if (not dimensions.isValid()
                or dimensions.width() > 10000
                or dimensions.height() > 10000
                or dimensions.width() * dimensions.height() > 25000000):
            buffer.close()
            return False

        picture = reader.read()
        buffer.close()

        if picture.isNull():
            return False

        max_width = max(
            320, self.attachment_image_scroll.viewport().width() - 25
        )
        if picture.width() > max_width:
            picture = picture.scaledToWidth(
                max_width, Qt.TransformationMode.SmoothTransformation
            )

        if not self.attachment_back_button.isVisible():
            self._attachment_previous = (
                self.body.toHtml(),
                self.subject.text(),
                self.meta.text()
            )

        self.subject.setText(str(filename)[:240])
        self.meta.setText("Image attachment · read-only preview")
        self.attachment_image_label.setPixmap(
            QPixmap.fromImage(picture)
        )
        self.body.hide()
        self.attachment_image_scroll.show()
        self.attachment_back_button.show()
        self.attachment_button.hide()
        return True

    def show_attachment_inline(self, filename, text):
        if not self.attachment_back_button.isVisible():
            self._attachment_previous = (
                self.body.toHtml(), self.subject.text(), self.meta.text())
        self.subject.setText(filename[:240])
        self.meta.setText("Text attachment · read-only preview")
        self.attachment_image_scroll.hide()
        self.attachment_image_label.clear()
        self.body.show()
        self.body.setPlainText(text)
        self.attachment_back_button.show()
        self.attachment_button.hide()

    def _back_from_attachment(self):
        previous = getattr(self, "_attachment_previous", None)
        if previous:
            html, subject, meta = previous
            self.body.setHtml(html)
            self.subject.setText(subject)
            self.meta.setText(meta)
        self._attachment_previous = None
        self.attachment_image_label.clear()
        self.attachment_image_scroll.hide()
        self.body.show()
        self.attachment_back_button.hide()

    def _request_attachments(self):
        if (self.local_mode and self.current_thread_id
                and self.current_thread_mailbox in self._mailboxes
                and self.attachment_button.isVisible()):
            self.attachmentRequested.emit(
                self.current_thread_mailbox,self.current_thread_id)

    def _request_ticket_link(self):
        if (not self.local_mode or self.current_thread_mailbox not in self._mailboxes
                or not self.current_thread_id or self.selected_folder in
                ("sent", "drafts", "spam", "trash")
                or self.ticket_link_button.isHidden()
                or not self.ticket_link_button.isEnabled()):
            return
        self.localTicketLinkRequested.emit(
            self.current_thread_mailbox, self.current_thread_id)

    def show_ticket_links(self, mailbox, thread_id, data):
        """Only server-confirmed links; missing migration is not an empty list."""
        if (not self.local_mode or mailbox != self.current_thread_mailbox
                or thread_id != self.current_thread_id):
            return False
        if (not isinstance(data, dict) or not data.get("available")
                or data.get("mailbox") != mailbox
                or data.get("thread_id") != thread_id
                or not isinstance(data.get("items"), list)):
            self.ticket_link_button.hide()
            self.ticket_link_button.setEnabled(False)
            return False
        total = len(data["items"])
        self.ticket_link_button.setText(
            "Linked tickets · " + str(total) if total else "Link to Ticket…")
        self.ticket_link_button.setToolTip(
            "Review existing ticket associations or explicitly link another ticket")
        self.ticket_link_button.setEnabled(True)
        return True

    def show_company_link(self, mailbox, thread_id, data):
        """Display the server-confirmed association; never infer from email sender."""
        if (not self.local_mode or mailbox != self.current_thread_mailbox
                or thread_id != self.current_thread_id):
            return False
        if not isinstance(data, dict) or data.get("mailbox") != mailbox or (
                data.get("thread_id") != thread_id):
            return False
        if data.get("linked"):
            self.crm_link_button.setText(
                "CRM: " + str(data.get("company_name") or "Linked company")[:50])
            self.crm_link_button.setEnabled(False)
            self.crm_link_button.setToolTip(
                "Company association saved. Correction needs a separate reviewed workflow.")
        else:
            self.crm_link_button.setText("Link to CRM…")
            self.crm_link_button.setEnabled(True)
            self.crm_link_button.setToolTip(
                "Review and select one existing company; no automatic identity matching.")
        return True

    def _request_full_text(self):
        if (not self.local_mode or self.current_thread_mailbox not in self._mailboxes
                or not self.current_thread_id or not self._full_text_options):
            return
        selected = self._full_text_options[0]
        if len(self._full_text_options) > 1:
            titles = [x[1] for x in self._full_text_options]
            title, accepted = QInputDialog.getItem(
                self, "Read full archived message", "Choose message:",
                titles, 0, False)
            if not accepted:
                return
            index = titles.index(title) if title in titles else -1
            if index < 0:
                return
            selected = self._full_text_options[index]
        self.fullTextRequested.emit(
            self.current_thread_mailbox, self.current_thread_id, selected[0])

    def _request_forward(self):
        if (not self.local_mode or self.current_thread_mailbox not in self._mailboxes
                or not self.current_thread_id
                or self.selected_folder in ("sent", "drafts")):
            return
        self.forwardRequested.emit(
            self.current_thread_mailbox, self.current_thread_id)

    def toggle_reply_participants(self):
        expanded = self.reply_people_panel.isHidden()
        self.reply_people_panel.setVisible(expanded)
        self.reply_add_people.setText(
            "Hide Cc/Bcc" if expanded else "Add people…"
        )

    def show_reply_editor(self, mailbox, thread_id, recipient):
        if (mailbox != self.current_thread_mailbox
                or thread_id != self.current_thread_id
                or not isinstance(recipient, str) or "@" not in recipient):
            return False
        if not self.reply_editor.isHidden():
            # Re-selecting Reply on the SAME conversation cannot erase
            # something the operator has already typed.
            self.reply_body.setFocus()
            return True
        self.reply_target.setText("Reply to: " + recipient)
        self.reply_body.clear()
        self.reply_send.setText("Send reply…")
        self.reply_send.setEnabled(True)
        self.reply_add_people.show()
        self.reply_all_toggle.show()
        self.reply_preview.show()
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
        if not self.reply_editor.isHidden():
            self.reply_body.setFocus()
            return True
        self.reply_target.setText("New follow-up to: " + recipient)
        self.reply_body.clear()
        self.reply_send.setText("Send follow-up…")
        self.reply_send.setEnabled(True)
        self.reply_add_people.hide()
        self.reply_all_toggle.hide()
        self.reply_preview.hide()
        self.reply_people_panel.hide()
        self.reply_editor.show()
        self.reply_body.setFocus()
        return True

    def _confirm_inline_reply_discard(self):
        """Protect inline replies and sent follow-ups before USER navigation.

        Inline text is not yet a saved PostgreSQL draft. A successful send
        uses hide_reply_editor() directly after the backend outcome is known.
        """
        # A background Mail tab is not visible, but its reply still exists.
        # Only an explicitly hidden editor has no active reply to protect.
        if self.reply_editor.isHidden():
            return True
        if not self.reply_send.isEnabled():
            QMessageBox.information(
                self, "Mail operation in progress",
                "Wait for the current reply outcome before changing conversations."
            )
            return False
        if (not self.reply_body.toPlainText().strip()
                and not self.reply_cc.text().strip()
                and not self.reply_bcc.text().strip()
                and not self.reply_all_toggle.isChecked()):
            return True
        decision = QMessageBox.question(
            self, "Discard unsent reply?",
            "This reply has not been saved or sent.\n\n"
            "Discard it and continue? Choosing No keeps the text here.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        return decision == QMessageBox.StandardButton.Yes

    def cancel_reply_editor(self):
        if self._confirm_inline_reply_discard():
            self.hide_reply_editor()

    def hide_reply_editor(self):
        """Only call directly after an intentional discard or confirmed send."""
        self.reply_editor.hide()
        self.reply_body.clear()
        self.reply_send.setEnabled(True)
        self.reply_people_panel.hide()
        self.reply_cc.clear()
        self.reply_bcc.clear()
        self.reply_all_toggle.setChecked(False)
        self.reply_add_people.setText("Add people…")
        self.reply_target.clear()

    def show_messages(self, mailbox, thread_id, messages):
        """Render only plain text; no HTML, resources or attachment downloads."""
        if (self.connection_state != "connected" or mailbox != self.current_thread_mailbox
                or thread_id != self.current_thread_id or not isinstance(messages, list)):
            return False
        self._attachment_snapshot = messages[:50]
        self._attachment_previous = None
        self.attachment_back_button.hide()
        self.attachment_image_label.clear()
        self.attachment_image_scroll.hide()
        self.body.show()
        cards = format_mail_message_cards(messages)
        if cards:
            self.body.setHtml(cards)
        else:
            self.body.setPlainText("No messages in this conversation.")
        self.meta.setText("{} message(s) · Safe text view · No remote content".format(
            len(messages[:50])))
        self.reader_stack.setCurrentIndex(1)
        self.reply_button.setText("Reply")
        self.reply_button.setToolTip("Reply in this conversation")
        self.reply_button.setVisible(self.local_mode and bool(messages)
                                     and self.selected_folder not in ("sent","drafts"))
        self.forward_button.setVisible(self.local_mode and bool(messages)
                                       and self.selected_folder not in ("sent","drafts"))
        self._full_text_options = [
            (str(m.get("id")),
             "{} · {}".format(
                 _safe_sender_label(m.get("from")),
                 _display_date(m.get("created_at")) or "Saved message"))
            for m in messages[:50]
            if (isinstance(m, dict) and m.get("preview_truncated") is True
                and isinstance(m.get("id"), str)
                and len(m["id"]) == 36)
        ]
        self.full_text_button.setVisible(
            self.local_mode and bool(self._full_text_options))
        self.crm_link_button.setText("Link to CRM…")
        self.crm_link_button.setEnabled(False)  # pending server-side link-status check
        self.crm_link_button.setVisible(
            self.local_mode and bool(messages)
            and self.selected_folder not in ("sent", "drafts", "spam", "trash"))
        self.ticket_link_button.setText("Link to Ticket…")
        self.ticket_link_button.setEnabled(False)  # server readback first
        self.ticket_link_button.setVisible(
            self.local_mode and bool(messages)
            and self.selected_folder not in ("sent", "drafts", "spam", "trash"))
        self.attachment_button.hide()
        # Opening a successfully rendered saved conversation marks it read.
        # Never mark unread items read on a failed/empty load or stale selection.
        if self.local_mode and messages and any(
            isinstance(record, dict)
            and record.get("id") == thread_id
            and record.get("mailbox") == mailbox
            and record.get("unread") is True
            for record in self.items
        ):
            self.localReadRequested.emit(mailbox, thread_id, False)
        self.document_dossier_button.setVisible(
            self.local_mode and bool(messages)
            and self.selected_folder not in ('sent', 'drafts')
            and any(isinstance(m, dict) and
                    (m.get('attachment_count') or
                     m.get('attachment_previews'))
                    for m in messages)
        )
        return True

    def apply_local_read_status(self, mailbox, thread_id, unread):
        """Apply a confirmed database readback without losing the live reader.

        Avoid reloading the folder: that would close a selected conversation
        or discard text being typed in the unsent inline reply editor.
        """
        if not self.local_mode or not isinstance(unread, bool):
            return False
        for index in range(self.thread_list.count()):
            entry = self.thread_list.item(index)
            if entry.data(Qt.ItemDataRole.UserRole) != (mailbox, thread_id):
                continue
            for record in self.items:
                if (isinstance(record, dict) and record.get("id") == thread_id
                        and record.get("mailbox") == mailbox):
                    record["unread"] = unread
            label = entry.text()
            star = "★ " if label.startswith("★ ") else ""
            body = label[len(star):].removeprefix("● ")
            entry.setText(star + ("● " if unread else "") + body)
            font = QFont(entry.font())
            font.setBold(unread)
            entry.setFont(font)
            return True
        return False
