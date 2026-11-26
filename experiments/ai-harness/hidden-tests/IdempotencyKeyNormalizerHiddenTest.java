package com.toss.cashback.domain.payment.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class IdempotencyKeyNormalizerHiddenTest {
    @Test void trimsAndCanonicalizesCase() {
        assertEquals("550e8400-e29b-41d4-a716-446655440000",
                IdempotencyKeyNormalizer.normalize("  550E8400-E29B-41D4-A716-446655440000  "));
    }

    @Test void acceptsVersionsOneThroughFive() {
        assertEquals('1', IdempotencyKeyNormalizer.normalize("550e8400-e29b-11d4-a716-446655440000").charAt(14));
        assertEquals('5', IdempotencyKeyNormalizer.normalize("550e8400-e29b-51d4-a716-446655440000").charAt(14));
    }

    @Test void rejectsNullAndBlank() {
        assertThrows(IllegalArgumentException.class, () -> IdempotencyKeyNormalizer.normalize(null));
        assertThrows(IllegalArgumentException.class, () -> IdempotencyKeyNormalizer.normalize("  "));
    }

    @Test void rejectsNonCanonicalShapes() {
        assertThrows(IllegalArgumentException.class, () -> IdempotencyKeyNormalizer.normalize("{550e8400-e29b-41d4-a716-446655440000}"));
        assertThrows(IllegalArgumentException.class, () -> IdempotencyKeyNormalizer.normalize("550e8400e29b41d4a716446655440000"));
        assertThrows(IllegalArgumentException.class, () -> IdempotencyKeyNormalizer.normalize("1-1-1-1-1"));
    }

    @Test void rejectsTrailingCharacters() {
        assertThrows(IllegalArgumentException.class, () -> IdempotencyKeyNormalizer.normalize("550e8400-e29b-41d4-a716-446655440000x"));
    }

    @Test void rejectsUnsupportedVersions() {
        assertThrows(IllegalArgumentException.class, () -> IdempotencyKeyNormalizer.normalize("550e8400-e29b-01d4-a716-446655440000"));
        assertThrows(IllegalArgumentException.class, () -> IdempotencyKeyNormalizer.normalize("550e8400-e29b-61d4-a716-446655440000"));
    }

    @Test void rejectsNonRfc4122Variant() {
        assertThrows(IllegalArgumentException.class, () -> IdempotencyKeyNormalizer.normalize("550e8400-e29b-41d4-7716-446655440000"));
    }
}
