package demo.observatory.catalog;

/** A catalog line that cannot be read. */
public class CatalogException extends Exception {
    private final int line;

    public CatalogException(int line, String message) {
        super("line " + line + ": " + message);
        this.line = line;
    }

    public int line() {
        return line;
    }
}
