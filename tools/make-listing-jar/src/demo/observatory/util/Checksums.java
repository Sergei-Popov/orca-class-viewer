package demo.observatory.util;

/** Adler-32 for frame files, so the archive can tell a cut upload. */
public final class Checksums {
    private static final int MOD = 65_521;

    private Checksums() {}

    public static long adler32(byte[] data) {
        int a = 1;
        int b = 0;
        for (byte value : data) {
            a = (a + (value & 0xFF)) % MOD;
            b = (b + a) % MOD;
        }
        return ((long) b << 16) | a;
    }

    public static String hex(long checksum) {
        return String.format("%08x", checksum);
    }
}
