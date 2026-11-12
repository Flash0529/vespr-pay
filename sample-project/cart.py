"""A tiny shopping cart. The discount function has a bug: the tests below find it."""


def total(items):
    """Sum of price * quantity for (name, price, quantity) tuples."""
    return sum(price * qty for _name, price, qty in items)


def apply_discount(amount, percent):
    """Take `percent` percent off `amount`."""
    return amount * percent / 100
