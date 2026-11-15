package demo.observatory.cli;

import demo.observatory.Observatory;

/** One thing the command line can do. */
public sealed interface Command permits ObserveCommand, PlanCommand, StackCommand {
    String name();

    ExitCode run(Observatory observatory, Console console);
}
