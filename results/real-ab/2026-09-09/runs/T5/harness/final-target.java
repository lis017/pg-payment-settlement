package com.toss.cashback.domain.settlement.service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Set;

public final class SettlementDateCalculator {

    private SettlementDateCalculator() {
    }

    public static LocalDate calculate(LocalDate paymentDate, int businessDays, Set<LocalDate> holidays) {
        if (paymentDate == null || businessDays < 0) {
            throw new IllegalArgumentException("paymentDate must not be null and businessDays must not be negative");
        }

        if (businessDays == 0) {
            return paymentDate;
        }

        int elapsedBusinessDays = 0;
        LocalDate settlementDate = paymentDate;

        while (elapsedBusinessDays < businessDays) {
            settlementDate = settlementDate.plusDays(1);
            DayOfWeek dayOfWeek = settlementDate.getDayOfWeek();

            if (dayOfWeek != DayOfWeek.SATURDAY
                    && dayOfWeek != DayOfWeek.SUNDAY
                    && (holidays == null || !holidays.contains(settlementDate))) {
                elapsedBusinessDays++;
            }
        }

        return settlementDate;
    }
}
