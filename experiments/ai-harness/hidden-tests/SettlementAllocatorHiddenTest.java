package com.toss.cashback.domain.settlement.service;

import org.junit.jupiter.api.Test;

import java.math.BigInteger;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SettlementAllocatorHiddenTest {
    @Test void distributesRemainderToEarliestRecipients() {
        assertEquals(List.of(4L, 3L, 3L), SettlementAllocator.allocate(10, 3));
    }

    @Test void supportsMoreRecipientsThanWon() {
        assertEquals(List.of(1L, 1L, 0L, 0L, 0L), SettlementAllocator.allocate(2, 5));
    }

    @Test void supportsZeroAmount() {
        assertEquals(List.of(0L, 0L, 0L), SettlementAllocator.allocate(0, 3));
    }

    @Test void rejectsInvalidArguments() {
        assertThrows(IllegalArgumentException.class, () -> SettlementAllocator.allocate(-1, 1));
        assertThrows(IllegalArgumentException.class, () -> SettlementAllocator.allocate(1, 0));
        assertThrows(IllegalArgumentException.class, () -> SettlementAllocator.allocate(1, 1001));
    }

    @Test void handlesLongMaxValueWithoutOverflow() {
        List<Long> result = SettlementAllocator.allocate(Long.MAX_VALUE, 1000);
        BigInteger sum = result.stream().map(BigInteger::valueOf).reduce(BigInteger.ZERO, BigInteger::add);
        assertEquals(BigInteger.valueOf(Long.MAX_VALUE), sum);
        assertTrue(result.get(0) - result.get(999) <= 1);
    }

    @Test void returnsUnmodifiableList() {
        List<Long> result = SettlementAllocator.allocate(3, 2);
        assertThrows(UnsupportedOperationException.class, () -> result.set(0, 0L));
    }
}
