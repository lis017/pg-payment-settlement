package com.toss.cashback.infrastructure.webhook;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class WebhookSignatureVerifierHiddenTest {
    @Test void producesKnownHmacSha256Vector() {
        assertEquals("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
                WebhookSignatureVerifier.sign("key", "The quick brown fox jumps over the lazy dog"));
    }

    @Test void verifiesValidSignatureCaseInsensitively() {
        String signature = WebhookSignatureVerifier.sign("비밀키", "{\"결제\":1000}");
        assertTrue(WebhookSignatureVerifier.verify("비밀키", "{\"결제\":1000}", signature));
        assertTrue(WebhookSignatureVerifier.verify("비밀키", "{\"결제\":1000}", signature.toUpperCase()));
    }

    @Test void rejectsChangedPayload() {
        String signature = WebhookSignatureVerifier.sign("secret", "payload");
        assertFalse(WebhookSignatureVerifier.verify("secret", "payload2", signature));
    }

    @Test void rejectsMalformedSignatureWithoutThrowing() {
        assertFalse(WebhookSignatureVerifier.verify("secret", "payload", null));
        assertFalse(WebhookSignatureVerifier.verify("secret", "payload", "abc"));
        assertFalse(WebhookSignatureVerifier.verify("secret", "payload", "z".repeat(64)));
    }

    @Test void rejectsInvalidSigningInputs() {
        assertThrows(IllegalArgumentException.class, () -> WebhookSignatureVerifier.sign(null, "x"));
        assertThrows(IllegalArgumentException.class, () -> WebhookSignatureVerifier.sign("", "x"));
        assertThrows(IllegalArgumentException.class, () -> WebhookSignatureVerifier.sign("x", null));
    }

    @Test void usesConstantTimeComparison() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/toss/cashback/infrastructure/webhook/WebhookSignatureVerifier.java"));
        assertTrue(source.contains("MessageDigest.isEqual"), "verification must use MessageDigest.isEqual");
    }
}
