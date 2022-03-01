use clap::{App, Arg, ArgMatches, SubCommand};

type Error = Box<dyn std::error::Error>;

mod terminal_agent;

fn main() -> Result<(), Error> {
    env_logger::Builder::from_default_env().init();

    let matches = App::new("codelldb")
        .arg(Arg::with_name("port").long("port").takes_value(true))
        .arg(Arg::with_name("multi-session").long("multi-session"))
        .arg(Arg::with_name("preload").long("preload").multiple(true).takes_value(true))
        .arg(Arg::with_name("liblldb").long("liblldb").takes_value(true))
        .arg(Arg::with_name("params").long("params").takes_value(true))
        .subcommand(SubCommand::with_name("terminal-agent").arg(Arg::with_name("port").long("port").takes_value(true)))
        .get_matches();

    if let Some(matches) = matches.subcommand_matches("terminal-agent") {
        terminal_agent::terminal_agent(&matches)
    } else {
        debug_server(&matches)
    }
}

fn debug_server(matches: &ArgMatches) -> Result<(), Error> {
    use loading::*;
    use std::mem::transmute;
    use std::path::{Path, PathBuf};

    let multi_session = matches.is_present("multi-session");
    let port = matches.value_of("port").map(|s| s.parse().unwrap()).unwrap_or(0);
    let adapter_params = matches.value_of("params");

    unsafe {
        // Preload anything passed via --preload
        for dylib in matches.values_of("preload").unwrap_or_default() {
            load_library(Path::new(dylib), true)?;
        }

        let mut codelldb_dir = std::env::current_exe()?;
        codelldb_dir.pop();

        // Load liblldb
        let liblldb_path = match matches.value_of("liblldb") {
            Some(path) => PathBuf::from(path),
            None => {
                let mut liblldb_path = codelldb_dir.clone();
                liblldb_path.pop();
                liblldb_path.push("lldb");
                liblldb_path.push(DYLIB_SUBDIR);
                liblldb_path.push(format!("liblldb.{}", DYLIB_EXTENSION));
                liblldb_path
            }
        };
        load_library(&liblldb_path, true)?;

        // Load codelldb shared lib
        let mut codelldb_path = codelldb_dir.clone();
        codelldb_path.push(format!("{}codelldb.{}", DYLIB_PREFIX, DYLIB_EXTENSION));
        let codelldb = load_library(&codelldb_path, false)?;

        // Find codelldb's entry point and call it.
        let entry: unsafe extern "C" fn(u16, bool, Option<&str>) = transmute(find_symbol(codelldb, "entry")?);
        entry(port, multi_session, adapter_params);
    }

    Ok(())
}
