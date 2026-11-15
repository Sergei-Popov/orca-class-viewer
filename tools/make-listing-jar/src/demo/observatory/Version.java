package demo.observatory;

/** The build of this toolkit. */
public final class Version {
    public static final String NAME = "observatory";
    public static final int MAJOR = 2;
    public static final int MINOR = 0;
    public static final int PATCH = 0;

    private Version() {}

    public static String text() {
        return NAME + " " + MAJOR + "." + MINOR + "." + PATCH;
    }
}
