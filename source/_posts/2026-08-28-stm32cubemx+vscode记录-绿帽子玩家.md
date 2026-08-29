---
title: stm32cubemx+vscode记录 - 绿帽子玩家
tags:
  - 计算机
categories:
  - 博客园
date: 2026-08-28 21:55:00
cnblogs_url: https://www.cnblogs.com/greenpia/p/22745774
---

1.环境配置 ai辅助配置 使用embedded-dev.embedded-c-toolchain，作者使用MIT协议但是没有建立一个公开的仓库（至少我没找到） 修改了bug的文件会放在评论区的github仓库 被迫学习typescript 这会变得非常简单： 自动检测还是很爽的 聪明的你肯定也发现了：什么！CXX executable test2.elf ! 由于cubemx构式的设置（无cubeide时）它不准你写cpp，可是lz有STL狂热！（对应过来应该是ETL狂热）那么我们怎么办呢： 2.折腾使用cpp 有这几步： 1.cubemx勾选Cmake...
<!-- more -->

<h1 id="1环境配置">1.环境配置</h1>
<p><s>ai辅助配置</s></p>
<blockquote>
<p>使用embedded-dev.embedded-c-toolchain，作者使用MIT协议但是没有建立一个公开的仓库（至少我没找到）<br>
修改了bug的文件会放在评论区的github仓库<br>
<s>被迫学习typescript</s></p>
</blockquote>
<p>这会变得非常简单：<br>
<img alt="image" loading="lazy" src="/images/cnblogs/22745774-3818850-20260828200148514-957488494.png" class="lazyload"></p>
<h3 id="自动检测还是很爽的">自动检测还是很爽的</h3>
<p><img alt="image" loading="lazy" src="/images/cnblogs/22745774-3818850-20260828201625278-1607706896.png" class="lazyload"></p>
<p>聪明的你肯定也发现了：什么！CXX executable test2.elf !<br>
由于cubemx构式的设置（无cubeide时）它不准你写cpp，可是lz有STL狂热！（对应过来应该是<a href="https://github.com/ETLCPP/etl" target="_blank" rel="noopener nofollow">ETL</a>狂热）那么我们怎么办呢：</p>
<h1 id="2折腾使用cpp">2.折腾使用cpp</h1>
<h3 id="有这几步">有这几步：</h3>
<hr>
<p>1.cubemx勾选<strong>Cmake</strong><br>
<img alt="image" loading="lazy" src="/images/cnblogs/22745774-3818850-20260828202923478-811038244.png" class="lazyload"></p>
<p>2.需要更改cmake配置文件：CmakeLists.txt中的部分</p>
<pre><code class="language-cmake">cmake_minimum_required(VERSION 3.22)

#
# This file is generated only once,
# and is not re-generated if converter is called multiple times.
#
# User is free to modify the file as much as necessary
#

# Setup compiler settings
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS ON)

# ===== 用户新增：C++ 编译标准设置 =====
# 本工程启用了 C++（使用 ETL 模板库以及 user_app 下的 .cpp 文件），
# 因此需要显式指定 C++ 标准。选用 C++17：
#   CMAKE_CXX_STANDARD_REQUIRED=ON : 强制要求编译器支持该标准，
#                                    不满足则在配置阶段直接报错，而不是静默降级。
#   CMAKE_CXX_EXTENSIONS=ON        : 允许使用编译器的 GNU 私有扩展。
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS ON)

# Define the build type
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Debug")
endif()

# Set the project name
set(CMAKE_PROJECT_NAME test2)

# Enable compile command to ease indexing with e.g. clangd
set(CMAKE_EXPORT_COMPILE_COMMANDS TRUE)

# Core project settings
project(${CMAKE_PROJECT_NAME})
message("Build type: " ${CMAKE_BUILD_TYPE})

# Enable CMake support for ASM and C languages
# ===== 用户修改：在 CubeMX 默认的 C/ASM 基础上追加 CXX =====
# STM32CubeMX 默认只生成 "enable_language(C ASM)"，
# 此处手动加上 CXX 以支持 C++ 源文件（user_app/*.cpp 以及 ETL 库）。
# 注意：必须在这里启用 CXX，否则后续 target_sources 中的 .cpp
#       会被当作 C 语言编译而报错，或根本无法参与编译。
enable_language(C ASM CXX)

# Create an executable object type
add_executable(${CMAKE_PROJECT_NAME})

# Add STM32CubeMX generated sources
add_subdirectory(cmake/stm32cubemx)

# ===== 用户新增：引入 ETL（Embedded Template Library）=====
# ETL 是专为嵌入式/资源受限环境设计的 C++ 模板库（类似 STL，但不依赖
# 动态内存分配/异常，适合裸机开发）。add_subdirectory 会把
# ../../libs/etl 当作一个独立的 CMake 子项目一起编译，
# 并产出目标 etl::etl，供下方 target_link_libraries 链接使用。
# 路径含义：${CMAKE_SOURCE_DIR} 是本文件所在目录（test2），
# 向上两级（../../）即 Keil_Project/STM32_HAL 下的 libs/etl。
add_subdirectory("${CMAKE_SOURCE_DIR}/../../libs/etl" etl)

# ===== 用户修改：把固定源码列表改为自动收集 =====
# CubeMX 原本会在下面写死一串 .c 文件路径；这里改成用 GLOB_RECURSE
# 递归收集 Core/user_app/src 目录下的所有 .c 和 .cpp，方便以后直接
# 往该目录加文件而无需改动本文件。
# CONFIGURE_DEPENDS：让 CMake 在源文件增删时自动重新配置。
# 注意：GLOB 只在配置阶段求值，若不加 CONFIGURE_DEPENDS，
#       新增文件必须手动重新运行 cmake 才会被识别。
file(GLOB_RECURSE USER_APP_SOURCES CONFIGURE_DEPENDS
    ${CMAKE_SOURCE_DIR}/Core/user_app/src/*.c
    ${CMAKE_SOURCE_DIR}/Core/user_app/src/*.cpp
)

# Add sources to executable
target_sources(${CMAKE_PROJECT_NAME} PRIVATE
    ${USER_APP_SOURCES}
)

# Add include paths
# ===== 用户新增：为 user_app 添加头文件搜索路径 =====
# 把 Core/user_app/inc 加入头文件搜索路径，使 user_app 里的 .cpp
# 可以直接 #include "xxx.h"，无需写相对路径。
# （右侧注释里是 CubeMX 原有的系统头文件路径清单，仅作备忘，
#   实际生效的头文件路径由 cmake/stm32cubemx 子目录负责添加。）
target_include_directories(
${CMAKE_PROJECT_NAME} PRIVATE     # Add user defined include paths  Core/Inc Drivers/CMSIS/Device/ST/STM32F1xx/Include Drivers/CMSIS/Include Drivers/STM32F1xx_HAL_Driver/Inc/Legacy Drivers/STM32F1xx_HAL_Driver/Inc
    ${CMAKE_SOURCE_DIR}/Core/user_app/inc
)

# Add project symbols (macros)
target_compile_definitions(${CMAKE_PROJECT_NAME} PRIVATE
    # Add user defined symbols
)

# ===== 用户新增：全局编译选项 =====
# 使用生成器表达式 $&lt;$&lt;COMPILE_LANGUAGE:XX&gt;:-Wall&gt; 按编译语言分别
# 加上 -Wall，开启所有常规警告，尽早暴露潜在代码问题。
# 注意：此处刻意不加 -pthread / -O3 —— 这是裸机(无 OS)目标，
#       既没有线程库，优化级别也由 CMakePresets.json 中的
#       构建类型(Debug/Release)统一控制，不应在此写死。
add_compile_options(
    "$&lt;$&lt;COMPILE_LANGUAGE:CXX&gt;:-Wall&gt;"
    "$&lt;$&lt;COMPILE_LANGUAGE:C&gt;:-Wall&gt;"
)

# Add linked libraries
# ===== 用户修改：链接库列表 =====
#   stm32cubemx : CubeMX 生成的外设/中间件静态库（来自 cmake/stm32cubemx 子目录）
#   etl::etl    : 用户新增，链接 ETL 模板库（见上方 add_subdirectory(../../libs/etl)）
# 注意：target_link_libraries 必须写在对应的 add_subdirectory 之后，
#       因为链接时目标(etl::etl)必须已经存在。
target_link_libraries(${CMAKE_PROJECT_NAME}
    stm32cubemx
    etl::etl
    # Add user defined libraries
)
</code></pre>
<h1 id="3使用cpp的注意事项">3.使用cpp的注意事项</h1>
<hr>
<ul>
<li>
<p>在cubemx里生成的.c文件里不能出现cpp的关键字以及特性（如namespace class，函数/结构体的默认值，各种各样的容器以及引用等）</p>
</li>
<li>
<p>所以建议单独分出一个文件夹用来写自己的逻辑，<br>
像：<img alt="image" loading="lazy" src="/images/cnblogs/22745774-3818850-20260828205855656-1570273282.png" class="lazyload"></p>
</li>
<li>
<p>写程序时建议采用以下格式：</p>
</li>
</ul>
<pre><code class="language-c">// main.c
#include "something_included"

mxinit(); //cubemx生成的初始化代码
setup(); //自己的集成初始化（cpp）

while (1) {
  loop(); //自己的逻辑（cpp）
}

/*

如果逻辑真的非常简单的话，可以参考这样：
//file.cpp
extern "C" {
int cpp_add(int a, int b)
{
    g_counter++;              // 内部用 C++ 没问题
    return internal_twice(a) + b; // 调用内部工具
}
}

// main.c gpio.c dma.c ... elsewhere
int main{
  cpp_add(x,y); //比如说传参/返回值类型不能是 string &amp;x，这个 extern "C" 的函数也不能有参数的默认值
}
// 其实所有出现在.c文件中的cpp functions（接口）都要用extern "C" 包裹

*/
</code></pre>
<p><s>改main.c为main.cpp解决99%的问题</s></p>
