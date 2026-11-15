package demo.observatory;

import demo.observatory.cli.Cli;
import demo.observatory.cli.Console;
import demo.observatory.cli.ExitCode;

/** Entry point: {@code java -jar observatory-2.0.0.jar observe Vega}. */
public final class Main {
    private Main() {}

    public static void main(String[] args) {
        Console console = Console.system();
        ExitCode code = new Cli(Observatory.defaults(), console).run(args);
        System.exit(code.status());
    }
}
