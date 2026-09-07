---
title: 学习stm32_StdPeriph... - 绿帽子玩家
tags:
  - 控制
categories:
  - 博客园
date: 2026-09-07 17:59:00
cnblogs_url: https://www.cnblogs.com/greenpia/p/22881593
---

还是要先打一下地基是吗。。。 事情的开头总是要困难一些的，不过还好这一个学期里我也稍微熟悉了一点无gui的操作了 通常BOOT0 = 0 当BOOT1 = 0, BOOT0 = 1时，可以串口下载程序 BOOT引脚功能只在上电后瞬间有效，之后恢复原复用 滤波电容可以在VDD - VSS间 GPIO模拟输入 + ADC -> 读取端口模拟电压 RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOC, ENABLE); // 打开 GPIOC 时钟 // SYSCLK ---> HCLK ---> PCLK2 -> GPIOC // AHB APB2...
<!-- more -->

<p>还是要先打一下地基是吗。。。<br>
事情的开头总是要困难一些的，不过还好这一个学期里我也稍微熟悉了一点无gui的操作了</p>
<blockquote>
<p>通常BOOT0 = 0<br>
当BOOT1 = 0, BOOT0 = 1时，可以串口下载程序<br>
BOOT引脚功能只在上电后瞬间有效，之后恢复原复用</p>
<p>滤波电容可以在VDD - VSS间<br>
<img alt="屏幕截图 2026-09-01 224152" loading="lazy" src="/images/cnblogs/22881593-3818850-20260908015348795-582738167.png" class="lazyload"></p>
<p>GPIO模拟输入 + ADC -&gt; 读取端口模拟电压</p>
<p>RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOC, ENABLE);  // 打开 GPIOC 时钟<br>
// SYSCLK ---&gt; HCLK ---&gt; PCLK2 -&gt; GPIOC<br>
//        AHB       APB2</p>
<pre><code class="language-c">void RCC_AHBPeriphClockCmd(uint32_t RCC_AHBPeriph, FunctionalState NewState);
void RCC_APB2PeriphClockCmd(uint32_t RCC_APB2Periph, FunctionalState NewState);
void RCC_APB1PeriphClockCmd(uint32_t RCC_APB1Periph, FunctionalState NewState);
</code></pre>
<p>// 其实GPIOx的Pin只有低16位有用（小端，32位）</p>
<p>// 从来就没有听懂过。。。<br>
<img alt="屏幕截图 2026-09-03 224907" loading="lazy" src="/images/cnblogs/22881593-3818850-20260908015431075-1003312618.png" class="lazyload"></p>
<p>// 施密特触发器可以对输入信号做滤波</p>
<p>// 上下拉电阻</p>
<pre><code class="language-c">typedef enum
{ 
  GPIO_Speed_10MHz = 1,
  GPIO_Speed_2MHz, 
  GPIO_Speed_50MHz
}GPIOSpeed_TypeDef;

typedef enum
{ GPIO_Mode_AIN = 0x0, // 模拟输入
  GPIO_Mode_IN_FLOATING = 0x04, // 浮空输入
  GPIO_Mode_IPD = 0x28, // 下拉输入
  GPIO_Mode_IPU = 0x48, // 上拉输入
  GPIO_Mode_Out_OD = 0x14, // 开漏输出
  GPIO_Mode_Out_PP = 0x10, // 推挽输出
  GPIO_Mode_AF_OD = 0x1C, // 复用开漏输出
  GPIO_Mode_AF_PP = 0x18 // 复用推挽输出
}GPIOMode_TypeDef;

/** @defgroup GPIO_pins_define 
  * @note 只有低16位
  */

#define GPIO_Pin_0                 ((uint16_t)0x0001)  /*!&lt; Pin 0 selected */
#define GPIO_Pin_1                 ((uint16_t)0x0002)  /*!&lt; Pin 1 selected */
... (#define GPIO_Pin_(i) (((uint16_t)0b0000000000000001)&lt;&lt;(i)))
#define GPIO_Pin_All               ((uint16_t)0xFFFF)  /*!&lt; All pins selected */

/** 
  * @brief General Purpose I/O
  */
typedef struct
{
  __IO uint32_t CRL;
  __IO uint32_t CRH;
  __IO uint32_t IDR;
  __IO uint32_t ODR;
  __IO uint32_t BSRR;
  __IO uint32_t BRR;
  __IO uint32_t LCKR;
} GPIO_TypeDef;

uint8_t GPIO_ReadInputDataBit(GPIO_TypeDef* GPIOx, uint16_t GPIO_Pin);
uint16_t GPIO_ReadInputData(GPIO_TypeDef* GPIOx);
uint8_t GPIO_ReadOutputDataBit(GPIO_TypeDef* GPIOx, uint16_t GPIO_Pin);
uint16_t GPIO_ReadOutputData(GPIO_TypeDef* GPIOx);

</code></pre>
<p>// 最好不要用pa0引脚</p>
<h1 id="️-中断双优先级核心总结">⚡️ 中断双优先级核心总结</h1>
<h3 id="-核心对比表">📊 核心对比表</h3>
<table>
<thead>
<tr>
<th style="text-align: left">特性</th>
<th style="text-align: left">抢占优先级（Pre-emption）</th>
<th style="text-align: left">响应优先级（Sub-priority / 子优先级）</th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align: left"><strong>底层数据结构</strong></td>
<td style="text-align: left"><strong>优先级栈（Stack）</strong> 📥</td>
<td style="text-align: left"><strong>优先队列（Queue）</strong> 👥</td>
</tr>
<tr>
<td style="text-align: left"><strong>生效时机</strong></td>
<td style="text-align: left">当前中断<strong>正在执行中</strong> 运行</td>
<td style="text-align: left">中断<strong>还没执行、正在排队</strong> 挂起</td>
</tr>
<tr>
<td style="text-align: left"><strong>核心能力</strong></td>
<td style="text-align: left"><strong>能</strong>打断正在运行的低优先级中断</td>
<td style="text-align: left"><strong>不能</strong>打断别人，仅决定排队顺序</td>
</tr>
<tr>
<td style="text-align: left"><strong>存在目的</strong></td>
<td style="text-align: left">确保极度紧急的任务能<strong>立刻插队</strong></td>
<td style="text-align: left">确保同时到达的任务能<strong>有序排队</strong></td>
</tr>
<tr>
<td style="text-align: left"><strong>系统影响</strong></td>
<td style="text-align: left">级别太多会导致<strong>栈溢出</strong>，需控制层级</td>
<td style="text-align: left">级别再多也<strong>不占用栈空间</strong>，系统更稳定</td>
</tr>
</tbody>
</table>
<hr>
<h3 id="-三句核心口诀">💡 三句核心口诀</h3>
<ul>
<li><strong>抢占看“打断”</strong>：抢占优先级不同，高者可以强行打断低者（压栈嵌套）。</li>
<li><strong>响应看“排队”</strong>：抢占优先级相同，同时触发时，响应优先级高者先执行。</li>
<li><strong>同级不互打</strong>：一旦中断开始执行，相同抢占优先级的中断绝对无法打断它，哪怕后者响应优先级更高，也只能在队列里死等。</li>
</ul>
<p>// 通常来说，NVIC的有关优先级的寄存器的话（f103是4位），工程上会分为两位响应优先级和两位抢占优先级</p>
<p>// EXTI中断：GPIO <strong>Pin号相同的不能同时触发中断</strong></p>
<p>为什么stm32f103 EXTI外部中断通道9~5 15~10总共只分配两个中断通道（两个ISR）？<br>
答：核心原因<br>
芯片为节省中断向量资源做的硬件设计优化。<br>
STM32F103为EXTI 0~4分配了独立中断通道，<br>
剩余11条线（5<sub>9和10</sub>15）因使用频率相对较低，被分别映射到EXTI9_5_IRQn和EXTI15_10_IRQn两个共享通道，<br>
以平衡芯片成本与应用需求。</p>
<p>在共享的ISR中，使用标准库函数轮询标志位来区分具体中断源，并依次处理：</p>
<pre><code class="language-c">void EXTI9_5_IRQHandler(void)
{
    // 检查 Line 5
    if(EXTI_GetITStatus(EXTI_Line5) != RESET) 
    {
        // 添加 EXTI5 处理代码
        EXTI_ClearITPendingBit(EXTI_Line5); // 清除标志
    }
    // 检查 Line 6
    if(EXTI_GetITStatus(EXTI_Line6) != RESET) 
    {
        // 添加 EXTI6 处理代码
        EXTI_ClearITPendingBit(EXTI_Line6);
    }
    // 继续检查 Line 7、8、9...
    // (10~15 同理写在 EXTI15_10_IRQHandler 中)
}
</code></pre>
<p>GPIO_PinRemapConfig<br>
GPIO_EXTILineConfig<br>
GPIO_EventOutputConfig</p>
<p>// EXTI外部中断捕获GPIO引脚电平变化的初始化：<br>
开启RCC(GPIOx &amp;&amp; AFIOx) -&gt; 初始化GPIO -&gt; 绑定EXTI中断线到AFIO -&gt; EXTI初始化 -&gt; 设置NVIC中断优先级分组(全局) -&gt; 初始化NVIC</p>
<pre><code>@param  EXTI_Line: specifies the EXTI lines to clear.
  *   This parameter can be any combination of EXTI_Linex where x can be (0..19).
</code></pre>
<p>中断服务函数的名称，如EXTI15_10_IRQHandler，是 "stm32f10x.h" : "IRQn_Type"(枚举量) -&gt; EXTI15_10_IRQn (名称改变只是改了一下结尾而已)</p>
<p>ITStatus EXTI_GetITStatus(uint32_t EXTI_Line);<br>
void EXTI_ClearITPendingBit(uint32_t EXTI_Line); // 中断里用</p>
</blockquote>
