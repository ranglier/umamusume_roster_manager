import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import fetch_meta_snapshot as fms  # noqa: E402


class ToPopularityTests(unittest.TestCase):
    def test_normalizes_against_the_max_count_and_keeps_counts(self):
        counts = Counter({"30010": 20, "30028": 10, "30016": 5})
        result = fms.to_popularity(counts, top=10)
        self.assertEqual(result["30010"], {"count": 20, "popularity": 1.0})
        self.assertEqual(result["30028"], {"count": 10, "popularity": 0.5})
        self.assertEqual(result["30016"], {"count": 5, "popularity": 0.25})

    def test_keeps_only_the_top_n_most_common(self):
        counts = Counter({"a": 5, "b": 4, "c": 3, "d": 2})
        result = fms.to_popularity(counts, top=2)
        self.assertEqual(set(result.keys()), {"a", "b"})

    def test_empty_counts_yield_empty_dict(self):
        self.assertEqual(fms.to_popularity(Counter(), top=10), {})


if __name__ == "__main__":
    unittest.main()
