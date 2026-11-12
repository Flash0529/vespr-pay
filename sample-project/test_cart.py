import unittest

from cart import apply_discount, total


class CartTests(unittest.TestCase):
    def test_total(self):
        self.assertEqual(total([("pen", 2.0, 3), ("book", 10.0, 1)]), 16.0)

    def test_discount_takes_percent_off(self):
        self.assertEqual(apply_discount(200.0, 25), 150.0)  # fails until the bug is fixed

    def test_no_discount(self):
        self.assertEqual(apply_discount(80.0, 0), 80.0)  # fails too


if __name__ == "__main__":
    unittest.main()
