set(LLVM_TRIPLE aarch64-unknown-linux-gnu)
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)
set(CMAKE_C_COMPILER clang)
set(CMAKE_CXX_COMPILER clang++)
set(CMAKE_C_FLAGS "-target ${LLVM_TRIPLE} -fuse-ld=lld")
set(CMAKE_CXX_FLAGS "-target ${LLVM_TRIPLE} -fuse-ld=lld")
set(CMAKE_STRIP llvm-strip)