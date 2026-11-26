package com.toss.cashback.infrastructure.webhook;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public final class WebhookSignatureVerifier {

    private static final String HMAC_SHA256 = "HmacSHA256";
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private WebhookSignatureVerifier() {
    }

    public static String sign(String secret, String payload) {
        if (secret == null || secret.isEmpty()) {
            throw new IllegalArgumentException("secret must not be null or empty");
        }
        if (payload == null) {
            throw new IllegalArgumentException("payload must not be null");
        }

        try {
            Mac mac = Mac.getInstance(HMAC_SHA256);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC_SHA256));
            byte[] signature = mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
            return toLowerHex(signature);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Unable to calculate webhook signature", exception);
        }
    }

    public static boolean verify(String secret, String payload, String suppliedHex) {
        if (payload == null || !isHexSha256(suppliedHex)) {
            return false;
        }

        byte[] suppliedSignature = fromHex(suppliedHex);
        byte[] expectedSignature = fromHex(sign(secret, payload));
        return MessageDigest.isEqual(expectedSignature, suppliedSignature);
    }

    private static boolean isHexSha256(String value) {
        if (value == null || value.length() != 64) {
            return false;
        }
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            if (!((character >= '0' && character <= '9')
                    || (character >= 'a' && character <= 'f')
                    || (character >= 'A' && character <= 'F'))) {
                return false;
            }
        }
        return true;
    }

    private static byte[] fromHex(String value) {
        byte[] result = new byte[value.length() / 2];
        for (int i = 0; i < result.length; i++) {
            result[i] = (byte) ((hexValue(value.charAt(i * 2)) << 4)
                    | hexValue(value.charAt(i * 2 + 1)));
        }
        return result;
    }

    private static int hexValue(char character) {
        if (character >= '0' && character <= '9') {
            return character - '0';
        }
        if (character >= 'a' && character <= 'f') {
            return character - 'a' + 10;
        }
        return character - 'A' + 10;
    }

    private static String toLowerHex(byte[] bytes) {
        char[] result = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            int value = bytes[i] & 0xff;
            result[i * 2] = HEX[value >>> 4];
            result[i * 2 + 1] = HEX[value & 0x0f];
        }
        return new String(result);
    }
}
