"""Unit tests for app.utils.tokens.count_tokens."""

from app.utils.tokens import count_tokens


def test_empty_returns_zero():
    assert count_tokens("") == 0
    assert count_tokens(None) == 0  # type: ignore[arg-type]


def test_english_chars_per_token_around_4():
    text = "Hello, this is an important technical document to process."
    n = count_tokens(text)
    # ~58 chars / ~4 chars-per-token ≈ 11-15 tokens for English
    assert 8 <= n <= 20


def test_vietnamese_more_tokens_than_english_equivalent():
    vi = "Xin chào, đây là tài liệu kỹ thuật quan trọng cần xử lý."
    en = "Hello, this is an important technical document to process."
    assert count_tokens(vi) > count_tokens(en)


def test_large_text_scales_roughly_linearly():
    short = "abc " * 100  # 400 chars
    long = "abc " * 1000  # 4000 chars
    assert count_tokens(long) > count_tokens(short) * 9
    assert count_tokens(long) < count_tokens(short) * 11


def test_special_tokens_in_text_dont_crash():
    # disallowed_special=() means raw <|endoftext|> is treated as plain text.
    text = "Section <|endoftext|> end."
    assert count_tokens(text) > 0
