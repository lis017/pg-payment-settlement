package com.toss.cashback.domain.payment.service;

import java.util.UUID;

public final class IdempotencyKeyNormalizer {

    private IdempotencyKeyNormalizer() {
    }

    public static String normalize(String raw) {
        if (raw == null) {
            throw new IllegalArgumentException("Idempotency key must not be null or blank");
        }

        String value = raw.trim();
        if (value.isEmpty()
                || !value.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) {
            throw new IllegalArgumentException("Idempotency key must be a canonical UUID");
        }

        final UUID uuid;
        try {
            uuid = UUID.fromString(value);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Idempotency key must be a valid UUID", exception);
        }

        if (uuid.version() < 1 || uuid.version() > 5 || uuid.variant() != 2) {
            throw new IllegalArgumentException("Idempotency key must be a version 1-5 RFC 4122 UUID");
        }

        return uuid.toString();
    }
}
