package com.toss.cashback.domain.payment.service;

import java.util.UUID;
import java.util.regex.Pattern;

public final class IdempotencyKeyNormalizer {

    private static final Pattern UUID_PATTERN = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    );

    private IdempotencyKeyNormalizer() {
    }

    public static String normalize(String raw) {
        if (raw == null) {
            throw new IllegalArgumentException("Idempotency key must not be null or blank");
        }

        String value = raw.trim();
        if (value.isBlank() || !UUID_PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Idempotency key must be a canonical UUID");
        }

        UUID uuid;
        try {
            uuid = UUID.fromString(value);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Idempotency key must be a valid UUID", exception);
        }

        if (uuid.version() < 1 || uuid.version() > 5) {
            throw new IllegalArgumentException("Idempotency key must use UUID version 1 through 5");
        }
        if (uuid.variant() != 2) {
            throw new IllegalArgumentException("Idempotency key must use RFC 4122 variant");
        }

        return uuid.toString();
    }
}
