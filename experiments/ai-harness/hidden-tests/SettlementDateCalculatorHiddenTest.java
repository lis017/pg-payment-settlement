package com.toss.cashback.domain.settlement.service;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class SettlementDateCalculatorHiddenTest {
    @Test void zeroBusinessDaysReturnsOriginalDate() {
        LocalDate saturday = LocalDate.of(2026, 9, 12);
        assertEquals(saturday, SettlementDateCalculator.calculate(saturday, 0, Set.of()));
    }

    @Test void excludesStartDateAndSkipsWeekend() {
        assertEquals(LocalDate.of(2026, 9, 14),
                SettlementDateCalculator.calculate(LocalDate.of(2026, 9, 11), 1, Set.of()));
    }

    @Test void skipsHolidayAndFollowingWeekend() {
        assertEquals(LocalDate.of(2026, 12, 28),
                SettlementDateCalculator.calculate(
                        LocalDate.of(2026, 12, 24), 1, Set.of(LocalDate.of(2026, 12, 25))));
    }

    @Test void countsMultipleBusinessDays() {
        assertEquals(LocalDate.of(2026, 9, 16),
                SettlementDateCalculator.calculate(LocalDate.of(2026, 9, 11), 3, Set.of()));
    }

    @Test void treatsNullHolidaysAsEmptyAndDoesNotMutateInput() {
        assertEquals(LocalDate.of(2026, 9, 14),
                SettlementDateCalculator.calculate(LocalDate.of(2026, 9, 11), 1, null));
        Set<LocalDate> holidays = new HashSet<>(Set.of(LocalDate.of(2026, 9, 14)));
        Set<LocalDate> before = Set.copyOf(holidays);
        SettlementDateCalculator.calculate(LocalDate.of(2026, 9, 11), 1, holidays);
        assertEquals(before, holidays);
    }

    @Test void rejectsInvalidArguments() {
        assertThrows(IllegalArgumentException.class, () -> SettlementDateCalculator.calculate(null, 1, Set.of()));
        assertThrows(IllegalArgumentException.class, () -> SettlementDateCalculator.calculate(LocalDate.now(), -1, Set.of()));
    }
}
