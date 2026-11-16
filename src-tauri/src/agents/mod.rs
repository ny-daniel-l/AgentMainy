//! Everything about watching AI agents: the hook CLI, the localhost event
//! server, state mapping, transcripts, subscription limits and the `ls/peek/
//! wait/send` orchestration CLI.
pub mod cli;
pub mod hooks;
pub mod limits;
pub mod orch;
pub mod server;
pub mod statemap;
pub mod transcript;
