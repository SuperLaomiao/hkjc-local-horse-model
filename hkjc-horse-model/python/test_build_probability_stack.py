import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from build_probability_stack import build_probability_stack  # noqa: E402


class ProbabilityStackTest(unittest.TestCase):
    @staticmethod
    def _component(target, model_id, probabilities):
        rows = []
        race_specs = (
            ("V1", "validation", (1, 0)),
            ("H1", "holdout", (0, 1)),
        )
        index = 0
        for race_id, split, labels in race_specs:
            for horse_no, label in enumerate(labels, start=1):
                rows.append({
                    "version": model_id,
                    "modelId": model_id,
                    "target": target,
                    "raceId": race_id,
                    "date": "2026-01-01" if split == "validation" else "2026-02-01",
                    "split": split,
                    "horseId": f"{race_id}-{horse_no}",
                    "horseNo": horse_no,
                    "fieldSize": 2,
                    "probability": probabilities[index],
                    "targetWin": label,
                    "targetPlace": label,
                })
                index += 1
        return rows

    def test_calibration_and_blend_selection_use_validation_only(self):
        calls = []

        def recording_fitter(method, probabilities, labels):
            calls.append({"method": method, "labels": list(labels), "rows": len(probabilities)})
            return lambda values: list(values)

        lightgbm_win = self._component("targetWin", "lgb", [0.8, 0.2, 0.7, 0.3])
        catboost_win = self._component("targetWin", "cat", [0.7, 0.3, 0.6, 0.4])
        lightgbm_place = self._component("targetPlace", "lgb", [0.7, 0.4, 0.6, 0.5])
        catboost_place = self._component("targetPlace", "cat", [0.6, 0.5, 0.55, 0.45])

        report, output_rows = build_probability_stack(
            lightgbm_win,
            catboost_win,
            lightgbm_place,
            catboost_place,
            calibration_fitter=recording_fitter,
        )

        self.assertEqual(len(calls), 8)
        self.assertTrue(all(call["labels"] == [1, 0] for call in calls))
        self.assertTrue(all(call["rows"] == 2 for call in calls))
        self.assertEqual(report["selectionSplit"], "validation")
        self.assertFalse(report["holdoutUsedForSelection"])
        self.assertFalse(report["promotion"]["automatic"])
        self.assertEqual(report["promotion"]["status"], "RESEARCH_CANDIDATE")
        for pool in ("WIN", "PLACE"):
            selection = report["pools"][pool]["selection"]
            self.assertEqual(selection["selectedOn"], "validation")
            self.assertFalse(selection["holdoutUsedForSelection"])
            self.assertIn(selection["blendWeightLightgbm"], [0.0, 0.25, 0.5, 0.75, 1.0])
            self.assertEqual(
                report["pools"][pool]["components"],
                {"lightgbmModelId": "lgb", "catboostModelId": "cat"},
            )

        validation_win = [row["winProbability"] for row in output_rows if row["split"] == "validation"]
        validation_place = [row["placeProbability"] for row in output_rows if row["split"] == "validation"]
        self.assertAlmostEqual(sum(validation_win), 1.0)
        self.assertAlmostEqual(sum(validation_place), 1.1)

    def test_selected_weight_is_applied_unchanged_to_holdout(self):
        identity = lambda _method, _probabilities, _labels: lambda values: list(values)
        report, output_rows = build_probability_stack(
            self._component("targetWin", "lgb", [0.8, 0.2, 0.7, 0.3]),
            self._component("targetWin", "cat", [0.7, 0.3, 0.6, 0.4]),
            self._component("targetPlace", "lgb", [0.7, 0.4, 0.6, 0.5]),
            self._component("targetPlace", "cat", [0.6, 0.5, 0.55, 0.45]),
            calibration_fitter=identity,
        )

        win_selection = report["pools"]["WIN"]["selection"]
        holdout_first = next(
            row for row in output_rows if row["split"] == "holdout" and row["horseNo"] == 1
        )
        weight = win_selection["blendWeightLightgbm"]
        expected = weight * 0.7 + (1.0 - weight) * 0.6
        expected /= weight * (0.7 + 0.3) + (1.0 - weight) * (0.6 + 0.4)
        self.assertAlmostEqual(holdout_first["winProbability"], expected)
        self.assertEqual(holdout_first["winBlendWeightLightgbm"], weight)

    def test_calibration_ties_use_uncalibrated_blend_for_ranking(self):
        def constant_fitter(_method, _probabilities, _labels):
            return lambda values: [0.5] * len(values)

        report, output_rows = build_probability_stack(
            self._component("targetWin", "lgb", [0.4, 0.6, 0.7, 0.3]),
            self._component("targetWin", "cat", [0.4, 0.6, 0.6, 0.4]),
            self._component("targetPlace", "lgb", [0.4, 0.6, 0.6, 0.5]),
            self._component("targetPlace", "cat", [0.4, 0.6, 0.55, 0.45]),
            calibration_fitter=constant_fitter,
        )

        self.assertEqual(report["pools"]["WIN"]["metrics"]["validation"]["topPickHits"], 0)
        validation_rows = [row for row in output_rows if row["split"] == "validation"]
        self.assertGreater(validation_rows[1]["winRankingScore"], validation_rows[0]["winRankingScore"])


if __name__ == "__main__":
    unittest.main()
