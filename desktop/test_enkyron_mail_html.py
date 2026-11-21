"""Regression: HTML-only and misleading 'None' emails remain readable.

Offline tests. No provider token, database, mail send or filesystem writes.
"""
import os
import unittest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
from PySide6.QtWidgets import QApplication, QTextBrowser
from PySide6.QtCore import QUrl
from PySide6.QtGui import QTextDocument

from desktop.enkyron_mail_html import safe_mail_html
from desktop.enkyron_mail_workspace import format_mail_message_cards, InlineMailBrowser


class InertHTMLMailTests(unittest.TestCase):
    def test_archived_invitation_body_overrides_four_character_none(self):
        original = (
            "<html><head><style>body{background:url(https://tracker.invalid)}</style>"
            "</head><body><table><tr><td><h1>Nepal-Europe</h1>"
            "<img src='https://tracker.invalid/banner' alt='Conference banner'>"
            "</td></tr></table><p>Dear Guillaume,</p>"
            "<p>Invitation to the technology and investment seminar.</p>"
            "</body></html>"
        )
        cards = format_mail_message_cards([{
            "from": "sarad@example.invalid", "subject": "Invitation",
            "text": "None", "html_inert": original, "html_only": False,
            "archive_state": "body_captured",
        }])
        self.assertIn("Dear Guillaume", cards)
        self.assertIn("Nepal-Europe", cards)
        self.assertIn("investment seminar", cards)
        self.assertIn("[Image blocked: Conference banner]", cards)
        self.assertNotIn("tracker.invalid", cards)
        self.assertNotIn("<img", cards)
        self.assertNotIn("<style", cards)
        self.assertNotIn("<script", cards)
        self.assertNotIn(">None<", cards)
        # Check what the actual Qt reader displays, not only the generated HTML.
        app = QApplication.instance() or QApplication([])
        reader = QTextBrowser()
        try:
            reader.setOpenExternalLinks(False)
            reader.setOpenLinks(False)
            reader.setHtml(cards)
            visible = reader.toPlainText()
            self.assertIn("Dear Guillaume", visible)
            self.assertIn("investment seminar", visible)
            self.assertNotIn("None", visible)
        finally:
            reader.close()

    def test_active_content_removed_and_links_only_visible_as_text(self):
        source = (
            '<script>alert("x")</script><svg onload="evil()"><text>X</text></svg>'
            '<iframe src="https://bad.invalid">hidden</iframe>'
            '<p style="background:url(https://track.invalid)" onclick="evil()">'
            '<a href="javascript:alert(1)" onclick="evil()">Bad link</a>'
            '<a href="https://example.org/register">Register</a></p>'
            '<img src="cid:active-image" onerror="evil()" alt="Event flyer">'
        )
        safe = safe_mail_html(source)
        for prohibited in (
            "alert(", "evil()", "<script", "<svg", "<iframe",
            "<a ", "<img", "track.invalid", "bad.invalid", "javascript:",
            "onclick", "onerror", "background:", "cid:active-image"
        ):
            self.assertNotIn(prohibited, safe)
        self.assertIn("Bad link", safe)
        self.assertIn("Register", safe)
        self.assertIn("https://example.org/register", safe)
        self.assertIn("[Image blocked: Event flyer]", safe)

    def test_images_are_blocked_until_explicit_opt_in(self):
        source = '<p>Hello <img src="https://images.example.invalid/pixel" alt="Tracking pixel"></p>'
        blocked = safe_mail_html(source)
        self.assertIn("[Image blocked: Tracking pixel]", blocked)
        self.assertNotIn("<img", blocked)
        permitted = safe_mail_html(source, allow_remote_images=True)
        self.assertIn('<img src="https://images.example.invalid/pixel" alt="Tracking pixel">',
                      permitted)
        app = QApplication.instance() or QApplication([])
        browser = InlineMailBrowser()
        try:
            self.assertFalse(browser.allow_remote_images)
            self.assertIsNone(browser.loadResource(
                QTextDocument.ResourceType.ImageResource,
                QUrl("https://images.example.invalid/pixel")))
        finally:
            browser.close()

    def test_html_parser_bounds_and_plain_text_fallback(self):
        self.assertEqual(safe_mail_html(None), "")
        self.assertEqual(safe_mail_html(""), "")
        self.assertEqual(safe_mail_html("<script>hidden</script>"), "")
        self.assertLessEqual(len(safe_mail_html("<p>" + "x" * 50000)), 120000)
        cards = format_mail_message_cards([{
            "from": "sender@example.invalid", "subject": "Text",
            "text": "Safe original plain text", "html_inert": None,
        }])
        self.assertIn("Safe original plain text", cards)
        self.assertNotIn("Remote images and active links are blocked.", cards)

    def test_truncated_html_is_labeled_and_malformed_markup_stays_inert(self):
        cards = format_mail_message_cards([{
            "text": "None",
            "html_inert": "<div><strong>Hello <img src='https://t.invalid/a'></div>",
            "html_preview_truncated": True,
        }])
        self.assertIn("Hello", cards)
        self.assertIn("HTML preview only", cards)
        self.assertNotIn("https://t.invalid", cards)
        self.assertNotIn("<img", cards)


if __name__ == "__main__":
    unittest.main()
