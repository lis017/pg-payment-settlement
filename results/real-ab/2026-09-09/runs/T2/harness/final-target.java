package com.toss.cashback.infrastructure.api;

public final class RetryBackoffPolicy {

    private RetryBackoffPolicy() {
    }

    public static long delayMillis(int attempt, long initialDelayMillis, long maxDelayMillis) {
        if (attempt <= 0
                || initialDelayMillis <= 0
                || maxDelayMillis <= 0
                || initialDelayMillis > maxDelayMillis) {
            throw new IllegalArgumentException("Invalid retry backoff parameters");
        }

        long delay = initialDelayMillis;
        for (int i = 1; i < attempt && delay < maxDelayMillis; i++) {
            if (delay > maxDelayMillis / 2) {
                return maxDelayMillis;
            }
            delay *= 2;
        }
        return delay;
    }
}
