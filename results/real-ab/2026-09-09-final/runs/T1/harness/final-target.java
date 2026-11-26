package com.toss.cashback.domain.settlement.service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class SettlementAllocator {

    private SettlementAllocator() {
    }

    public static List<Long> allocate(long amount, int recipients) {
        if (amount < 0 || recipients < 1 || recipients > 1000) {
            throw new IllegalArgumentException("amount must be non-negative and recipients must be between 1 and 1000");
        }

        long quotient = amount / recipients;
        long remainder = amount % recipients;
        List<Long> allocations = new ArrayList<>(recipients);

        for (int index = 0; index < recipients; index++) {
            allocations.add(index < remainder ? quotient + 1 : quotient);
        }

        return Collections.unmodifiableList(allocations);
    }
}
