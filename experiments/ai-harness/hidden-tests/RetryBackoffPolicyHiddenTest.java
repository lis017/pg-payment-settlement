package com.toss.cashback.infrastructure.api;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class RetryBackoffPolicyHiddenTest {
    @Test void computesOneBasedExponentialDelay() {
        assertEquals(100L, RetryBackoffPolicy.delayMillis(1, 100, 10_000));
        assertEquals(200L, RetryBackoffPolicy.delayMillis(2, 100, 10_000));
        assertEquals(800L, RetryBackoffPolicy.delayMillis(4, 100, 10_000));
    }

    @Test void capsAtMaximum() {
        assertEquals(1_000L, RetryBackoffPolicy.delayMillis(8, 100, 1_000));
    }

    @Test void saturatesInsteadOfOverflowing() {
        assertEquals(Long.MAX_VALUE, RetryBackoffPolicy.delayMillis(63, Long.MAX_VALUE / 2, Long.MAX_VALUE));
    }

    @Test void handlesHugeAttemptEfficiently() {
        assertEquals(5_000L, RetryBackoffPolicy.delayMillis(Integer.MAX_VALUE, 1, 5_000));
    }

    @Test void acceptsEqualInitialAndMaximum() {
        assertEquals(7L, RetryBackoffPolicy.delayMillis(100, 7, 7));
    }

    @Test void rejectsInvalidArguments() {
        assertThrows(IllegalArgumentException.class, () -> RetryBackoffPolicy.delayMillis(0, 1, 2));
        assertThrows(IllegalArgumentException.class, () -> RetryBackoffPolicy.delayMillis(1, 0, 2));
        assertThrows(IllegalArgumentException.class, () -> RetryBackoffPolicy.delayMillis(1, 2, 0));
        assertThrows(IllegalArgumentException.class, () -> RetryBackoffPolicy.delayMillis(1, 3, 2));
    }
}
