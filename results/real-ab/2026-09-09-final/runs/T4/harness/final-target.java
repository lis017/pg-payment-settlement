package com.toss.cashback.infrastructure.webhook;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class WebhookSignatureVerifier {

    private static final String HMAC_SHA256 = "HmacSHA256";

    private WebhookSignatureVerifier() {
    }

    public static String sign(String secret, String payload) {
        validateSecret(secret);
        validatePayload(payload);

        byte[] signature = calculateSignature(secret, payload);
        StringBuilder hex = new StringBuilder(signature.length * 2);
        for (byte value : signature) {
            hex.append(Character.forDigit((value >>> 4) & 0x0f, 16));
            hex.append(Character.forDigit(value & 0x0f, 16));
        }
        return hex.toString();
    }

    public static boolean verify(String secret, String payload, String suppliedHex) {
        validateSecret(secret);
        validatePayload(payload);

        if (suppliedHex == null || suppliedHex.length() != 64) {
            return false;
        }

        byte[] suppliedSignature = new byte[32];
        for (int i = 0; i < suppliedSignature.length; i++) {
            int high = Character.digit(suppliedHex.charAt(i * 2), 16);
            int low = Character.digit(suppliedHex.charAt(i * 2 + 1), 16);
            if (high < 0 || low < 0) {
                return false;
            }
            suppliedSignature[i] = (byte) ((high << 4) | low);
        }

        return MessageDigest.isEqual(calculateSignature(secret, payload), suppliedSignature);
    }

    private static void validateSecret(String secret) {
        if (secret == null || secret.isEmpty()) {
            throw new IllegalArgumentException("Secret must not be null or empty");
        }
    }

    private static void validatePayload(String payload) {
        if (payload == null) {
            throw new IllegalArgumentException("Payload must not be null");
        }
    }

    private static byte[] calculateSignature(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance(HMAC_SHA256);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC_SHA256));
            return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Unable to calculate webhook signature", exception);
        }
    }
}
