import unittest
from enkyron_mission_board_model import (
    normalize_missions, demo_missions, progress, totals, filter_missions, time_summary,
    normalize_crm_companies,
)


class MissionBoardModelTests(unittest.TestCase):
    def test_synthetic_labeling(self):
        rows = demo_missions()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all('fictitious' in x['company_name'] for x in rows))
        self.assertTrue(all(x['status'] == 'planning' for x in rows))

    def test_progress(self):
        self.assertEqual(progress(demo_missions()[0]), (2, 5, 40))
        self.assertEqual(totals(demo_missions()), {
            'missions': 2, 'open_tasks': 3, 'milestones': 1, 'completed': 2})

    def test_search(self):
        self.assertEqual(len(filter_missions(demo_missions(), 'cloud')), 1)
        self.assertEqual(len(filter_missions(demo_missions(), 'example')), 2)
        self.assertEqual(len(filter_missions(demo_missions(), 'not existent')), 0)

    def test_blocks_invalid_rows(self):
        row = demo_missions()[0].copy()
        row['status'] = 'active'
        self.assertEqual(normalize_missions([row]), [])
        self.assertEqual(normalize_missions([{'status': 'planning', 'title': 'X'}]), [])
        self.assertEqual(normalize_missions('injected'), [])

    def test_bad_work_item_link_dropped(self):
        row = demo_missions()[0].copy()
        task = row['work_items'][0].copy()
        task['mission_id'] = '33333333-3333-4333-8333-333333333333'
        row['work_items'] = [task]
        self.assertEqual(progress(normalize_missions([row])[0]), (0, 0, 0))

    def test_display_text_bounded(self):
        row = demo_missions()[0].copy()
        row['title'] = 'x' * 900 + '\u202e'
        row['description'] = 'y' * 9000
        output = normalize_missions([row])[0]
        self.assertEqual(len(output['title']), 160)
        self.assertEqual(len(output['description']), 2000)

    def test_input_not_mutated(self):
        raw = demo_missions()
        other = normalize_missions(raw)
        other[0]['work_items'].clear()
        self.assertEqual(len(raw[0]['work_items']), 5)

    def test_limits(self):
        rows = [dict(demo_missions()[0],
                     id=f'{i:08x}-2222-4333-8444-555555555555')
                for i in range(140)]
        self.assertEqual(len(normalize_missions(rows)), 50)


    def test_internal_time_summary_is_draft_only(self):
        rows = demo_missions()
        self.assertEqual(time_summary(rows[0]), (255, "4h 15m"))
        self.assertEqual(time_summary(rows[1]), (45, "0h 45m"))
        self.assertEqual(len(rows[0]["time_entries"]), 2)
        self.assertTrue(all(x["billing_state"] == "not_billable"
                            for m in rows for x in m["time_entries"]))

    def test_bad_time_entries_dropped_without_changing_valid_task(self):
        m = demo_missions()[0].copy()
        wrong_mission = dict(m["time_entries"][0],
                             mission_id="33333333-4444-4333-8333-333333333333")
        invalid_minutes = dict(m["time_entries"][1], minutes=900)
        premature_billing = dict(m["time_entries"][1], billing_state="billable")
        m["time_entries"] = [wrong_mission, invalid_minutes, premature_billing]
        result = normalize_missions([m])[0]
        self.assertEqual(result["time_entries"], [])
        self.assertEqual(progress(result), (2, 5, 40))

    def test_time_reference_must_be_known_work_item(self):
        m = demo_missions()[0].copy()
        other = dict(m["time_entries"][0],
                     work_item_id="33333333-3333-4333-8333-333333333333")
        m["time_entries"] = [other]
        self.assertEqual(normalize_missions([m])[0]["time_entries"], [])

    def test_crm_companies_are_not_missions_and_invalid_rows_disappear(self):
        row = {"id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
               "name": "Acme Ltd", "relationship_state": "prospect",
               "city": "London", "country": "UK"}
        self.assertEqual(normalize_crm_companies([row])[0]["name"], "Acme Ltd")
        self.assertEqual(normalize_crm_companies([row, row]), normalize_crm_companies([row]))
        self.assertEqual(normalize_crm_companies([
            {**row, "id": "invalid"}, {**row, "relationship_state": "active"}
        ]), [])
        self.assertEqual(normalize_crm_companies([row])[0].keys(),
            {"id", "name", "relationship_state", "city", "country"})
        self.assertEqual(normalize_crm_companies(None), [])
        self.assertEqual(len(demo_missions()), 2)


if __name__ == '__main__':
    unittest.main()
