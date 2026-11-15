package demo.observatory.cli;

/** Process exit statuses, as sysexits.h names them. */
public enum ExitCode {
    OK(0), FAILED(1), USAGE(64), DATA(65), UNAVAILABLE(69);

    private final int status;

    ExitCode(int status) {
        this.status = status;
    }

    public int status() {
        return status;
    }
}
