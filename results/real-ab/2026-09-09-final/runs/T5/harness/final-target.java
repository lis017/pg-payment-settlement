package com.toss.cashback.domain.settlement.service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Set;

public final class SettlementDateCalculator {

    private SettlementDateCalculator() {
    }

    public static LocalDate calculate(LocalDate paymentDate, int businessDays, Set<LocalDate> holidays) {
        if (paymentDate == null || businessDays < 0) {
            throw new IllegalArgumentException();
        }

        if (businessDays == 0) {
            return paymentDate;
        }

        LocalDate date = paymentDate;
        int countedBusinessDays = 0;
        while (countedBusinessDays < businessDays) {
            date = date.plusDays(1);
            if (isBusinessDay(date, holidays)) {
                countedBusinessDays++;
            }
        }
        return date;
    }

    private static boolean isBusinessDay(LocalDate date, Set<LocalDate> holidays) {
        DayOfWeek dayOfWeek = date.getDayOfWeek();
        return dayOfWeek != DayOfWeek.SATURDAY
                && dayOfWeek != DayOfWeek.SUNDAY
                && (holidays == null || !holidays.contains(date));
    }
}
