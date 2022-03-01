use super::*;

cpp_class!(pub unsafe struct SBProcess as "SBProcess");

unsafe impl Send for SBProcess {}

impl SBProcess {
    pub fn process_id(&self) -> ProcessID {
        cpp!(unsafe [self as "SBProcess*"] -> ProcessID as "lldb::pid_t" {
            return self->GetProcessID();
        })
    }
    pub fn target(&self) -> SBTarget {
        cpp!(unsafe [self as "SBProcess*"] -> SBTarget as "SBTarget" {
                return self->GetTarget();
        })
    }
    pub fn num_threads(&self) -> u32 {
        cpp!(unsafe [self as "SBProcess*"] -> u32 as "uint32_t" {
                return self->GetNumThreads();
        })
    }
    pub fn thread_at_index(&self, index: u32) -> SBThread {
        cpp!(unsafe [self as "SBProcess*", index as "uint32_t"] -> SBThread as "SBThread" {
            return self->GetThreadAtIndex(index);
        })
    }
    pub fn threads<'a>(&'a self) -> impl Iterator<Item = SBThread> + 'a {
        SBIterator::new(self.num_threads(), move |index| self.thread_at_index(index))
    }
    pub fn state(&self) -> ProcessState {
        cpp!(unsafe [self as "SBProcess*"] -> ProcessState as "uint32_t" {
            return self->GetState();
        })
    }
    pub fn exit_status(&self) -> i32 {
        cpp!(unsafe [self as "SBProcess*"] -> i32 as "int32_t" {
            return self->GetExitStatus();
        })
    }
    pub fn selected_thread(&self) -> SBThread {
        cpp!(unsafe [self as "SBProcess*"] -> SBThread as "SBThread" {
            return self->GetSelectedThread();
        })
    }
    pub fn set_selected_thread(&self, thread: &SBThread) -> bool {
        cpp!(unsafe [self as "SBProcess*", thread as "SBThread*"] -> bool as "bool" {
            return self->SetSelectedThread(*thread);
        })
    }
    pub fn thread_by_id(&self, tid: ThreadID) -> Option<SBThread> {
        cpp!(unsafe [self as "SBProcess*", tid as "tid_t"] -> SBThread as "SBThread" {
            return self->GetThreadByID(tid);
        })
        .check()
    }
    pub fn thread_by_index_id(&self, index_id: u32) -> Option<SBThread> {
        cpp!(unsafe [self as "SBProcess*", index_id as "uint32_t"] -> SBThread as "SBThread" {
            return self->GetThreadByIndexID(index_id);
        })
        .check()
    }
    pub fn resume(&self) -> Result<(), SBError> {
        cpp!(unsafe [self as "SBProcess*"] -> SBError as "SBError" {
            return self->Continue();
        })
        .into_result()
    }
    pub fn stop(&self) -> Result<(), SBError> {
        cpp!(unsafe [self as "SBProcess*"] -> SBError as "SBError" {
            return self->Stop();
        })
        .into_result()
    }
    pub fn kill(&self) -> Result<(), SBError> {
        cpp!(unsafe [self as "SBProcess*"] -> SBError as "SBError" {
            return self->Kill();
        })
        .into_result()
    }
    pub fn detach(&self) -> Result<(), SBError> {
        cpp!(unsafe [self as "SBProcess*"] -> SBError as "SBError" {
            return self->Detach();
        })
        .into_result()
    }
    pub fn broadcaster(&self) -> SBBroadcaster {
        cpp!(unsafe [self as "SBProcess*"] -> SBBroadcaster as "SBBroadcaster" {
            return self->GetBroadcaster();
        })
    }
    pub fn broadcaster_class_name() -> &'static str {
        let ptr = cpp!(unsafe [] -> *const c_char as "const char*" {
            return SBProcess::GetBroadcasterClassName();
        });
        unsafe { get_str(ptr) }
    }
    pub fn put_stdin(&self, buffer: &[u8]) -> usize {
        let ptr = buffer.as_ptr();
        let len = buffer.len();
        cpp!(unsafe [self as "SBProcess*", ptr as "uint8_t*", len as "size_t"] -> usize as "size_t" {
            return self->PutSTDIN((char*)ptr, len);
        })
    }
    pub fn read_stdout(&self, buffer: &mut [u8]) -> usize {
        let ptr = buffer.as_mut_ptr();
        let len = buffer.len();
        cpp!(unsafe [self as "SBProcess*", ptr as "uint8_t*", len as "size_t"] -> usize as "size_t" {
            return self->GetSTDOUT((char*)ptr, len);
        })
    }
    pub fn read_stderr(&self, buffer: &mut [u8]) -> usize {
        let ptr = buffer.as_mut_ptr();
        let len = buffer.len();
        cpp!(unsafe [self as "SBProcess*", ptr as "uint8_t*", len as "size_t"] -> usize as "size_t" {
            return self->GetSTDERR((char*)ptr, len);
        })
    }
    pub fn read_memory(&self, addr: Address, buffer: &mut [u8]) -> Result<usize, SBError> {
        let ptr = buffer.as_mut_ptr();
        let len = buffer.len();
        let mut error = SBError::new();
        let bytes_read = cpp!(unsafe [self as "SBProcess*", addr as "addr_t", ptr as "uint8_t*", len as "size_t",
                                      mut error as "SBError"] -> usize as "size_t" {
            return self->ReadMemory(addr, (void*)ptr, len, error);
        });
        if error.is_success() {
            Ok(bytes_read)
        } else {
            Err(error)
        }
    }
}

impl IsValid for SBProcess {
    fn is_valid(&self) -> bool {
        cpp!(unsafe [self as "SBProcess*"] -> bool as "bool" {
            return self->IsValid();
        })
    }
}

impl fmt::Debug for SBProcess {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        debug_descr(f, |descr| {
            cpp!(unsafe [self as "SBProcess*", descr as "SBStream*"] -> bool as "bool" {
                return self->GetDescription(*descr);
            })
        })
    }
}

#[derive(Clone, Copy, Eq, PartialEq, Debug)]
#[repr(u32)]
pub enum ProcessState {
    Invalid = 0,
    Unloaded = 1,
    Connected = 2,
    Attaching = 3,
    Launching = 4,
    Stopped = 5,
    Running = 6,
    Stepping = 7,
    Crashed = 8,
    Detached = 9,
    Exited = 10,
    Suspended = 11,
}

impl ProcessState {
    pub fn is_alive(&self) -> bool {
        use ProcessState::*;
        match self {
            Attaching | Launching | Stopped | Running | Stepping | Crashed | Suspended => true,
            _ => false,
        }
    }

    pub fn is_running(&self) -> bool {
        use ProcessState::*;
        match self {
            Attaching | Launching | Running | Stepping => true,
            _ => false,
        }
    }

    pub fn is_stopped(&self) -> bool {
        use ProcessState::*;
        match self {
            Stopped | Crashed | Suspended | Unloaded | Exited => true,
            _ => false,
        }
    }
}
