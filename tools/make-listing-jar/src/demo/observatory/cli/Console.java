package demo.observatory.cli;

import java.io.PrintStream;
import java.util.List;

/** Where commands print: a terminal, or a buffer in tests. */
public final class Console {
    private final PrintStream out;
    private final PrintStream err;

    public Console(PrintStream out, PrintStream err) {
        this.out = out;
        this.err = err;
    }

    public static Console system() {
        return new Console(System.out, System.err);
    }

    public void println(String line) {
        out.println(line);
    }

    public void error(String message) {
        err.println("observatory: " + message);
    }

    /** Rows padded into columns. */
    public void table(List<String[]> rows) {
        int[] widths = new int[rows.isEmpty() ? 0 : rows.get(0).length];
        for (String[] row : rows) {
            for (int i = 0; i < widths.length; i++) {
                widths[i] = Math.max(widths[i], row[i].length());
            }
        }
        for (String[] row : rows) {
            StringBuilder line = new StringBuilder();
            for (int i = 0; i < widths.length; i++) {
                line.append(String.format("%-" + (widths[i] + 2) + "s", row[i]));
            }
            out.println(line.toString().stripTrailing());
        }
    }
}
