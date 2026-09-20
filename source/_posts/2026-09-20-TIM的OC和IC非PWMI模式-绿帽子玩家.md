---
title: TIM的OC和IC(非PWMI模式) - 绿帽子玩家
tags:
  - 控制
categories:
  - 博客园
date: 2026-09-20 06:35:00
cnblogs_url: https://www.cnblogs.com/greenpia/p/23048229
---

tim其它...(高级的特性？) PWM 频率与占空比 $$PWM_f = TIM_f/((PSC+1)*(ARR+1))$$ $$Duty = CCR/(ARR+1)$$ // 所以一般普遍来说 改PSC和CCR会好一些 // void TIM_PrescalerConfig(TIM_TypeDef* TIMx, uint16_t Prescaler, uint16_t TIM_PSCReloadMode); // TIM_PSCReloadMode can be TIM_PSCReloadMode_Update or TIM_PSCReloadMode_Immediate //...
<!-- more -->

<h1 id="tim其它高级的特性">tim其它...(高级的特性？)</h1>
<h2 id="pwm-频率与占空比">PWM 频率与占空比</h2>
<p>$$PWM_f = TIM_f/((PSC+1)*(ARR+1))$$</p>
<p>$$Duty = CCR/(ARR+1)$$</p>
<pre><code class="language-c">// 所以一般普遍来说 改PSC和CCR会好一些 
// void TIM_PrescalerConfig(TIM_TypeDef* TIMx, uint16_t Prescaler, uint16_t TIM_PSCReloadMode); // TIM_PSCReloadMode can be TIM_PSCReloadMode_Update or TIM_PSCReloadMode_Immediate
// uint16_t TIM_GetPrescaler(TIM_TypeDef* TIMx); // PSC

// void TIM_SetComparek(TIM_TypeDef* TIMx, uint16_t Comparek); (where x can be 1-4)
// uint16_t TIM_GetCapturek(TIM_TypeDef* TIMx); (where x can be 1-4) // CCR
</code></pre>
<h2 id="外部时钟源">外部时钟源</h2>
<pre><code class="language-c">// 外部时钟源? 
void TIM_InternalClockConfig(TIM_TypeDef* TIMx);
void TIM_ITRxExternalClockConfig(TIM_TypeDef* TIMx, uint16_t TIM_InputTriggerSource);
void TIM_TIxExternalClockConfig(TIM_TypeDef* TIMx, uint16_t TIM_TIxExternalCLKSource,
                                uint16_t TIM_ICPolarity, uint16_t ICFilter);
void TIM_ETRClockMode1Config(TIM_TypeDef* TIMx, uint16_t TIM_ExtTRGPrescaler, uint16_t TIM_ExtTRGPolarity,
                             uint16_t ExtTRGFilter);
void TIM_ETRClockMode2Config(TIM_TypeDef* TIMx, uint16_t TIM_ExtTRGPrescaler, 
                             uint16_t TIM_ExtTRGPolarity, uint16_t ExtTRGFilter);
void TIM_ETRConfig(TIM_TypeDef* TIMx, uint16_t TIM_ExtTRGPrescaler, uint16_t TIM_ExtTRGPolarity,
                   uint16_t ExtTRGFilter);
</code></pre>
<p>孩子们市电当作外部时钟源有没有懂得</p>
<p>$$f=1/Ts \quad duty=Ton/Ts$$</p>
<h2 id="输出比较--pwm">输出比较 / PWM</h2>
<pre><code class="language-c">/* 输出比较/PWM配置：决定一个通道怎样输出波形 */
typedef struct
{
    uint16_t TIM_OCMode;
    // 输出比较模式，如 PWM1、PWM2、翻转模式等
	// TIM_OCMode_PWM1, TIM_OCMode_PWM2
	
    uint16_t TIM_OutputState;
    // 是否使能普通输出通道
	// TIM_OutputState_Enable
	
    uint16_t TIM_OutputNState;
    // 是否使能互补输出 CHxN，仅 TIM1/TIM8 使用
	
    uint16_t TIM_Pulse;
    // 比较值 CCRx
    // PWM模式下主要决定占空比：Duty ≈ CCR / (ARR + 1)
	// void TIM_SetComparek(TIM_TypeDef* TIMx, uint16_t Comparek)
	// uint16_t TIM_GetCapturek(TIM_TypeDef* TIMx);

    uint16_t TIM_OCPolarity;
    // 普通通道输出极性：高有效或低有效
	// TIM_OCPolarity_High, TIM_OCPolarity_Low

    uint16_t TIM_OCNPolarity;
    // 互补通道输出极性，仅 TIM1/TIM8 使用

    uint16_t TIM_OCIdleState;
    // 普通通道空闲时的电平，仅 TIM1/TIM8 使用

    uint16_t TIM_OCNIdleState;
    // 互补通道空闲时的电平，仅 TIM1/TIM8 使用

} TIM_OCInitTypeDef;

void TIM_SetCompare1(TIM_TypeDef* TIMx, uint16_t Compare1);
void TIM_SetCompare2(TIM_TypeDef* TIMx, uint16_t Compare2);
void TIM_SetCompare3(TIM_TypeDef* TIMx, uint16_t Compare3);
void TIM_SetCompare4(TIM_TypeDef* TIMx, uint16_t Compare4);
</code></pre>
<pre><code class="language-text">TIM输出PWM: TIM_CounterMode &amp;&amp; TIM_OCMode   &amp;&amp;   TIM_OCPolarity
                            TIM_OCMode_PWM1   TIM_OCPolarity_High
</code></pre>
<pre><code class="language-text">输出比较TIM初始化: 
RCC(有GPIO_PinRemapConfig时就有AFIO) -&gt; GPIO初始化 
-&gt; (GPIO_PinRemapConfig 注意 GPIO_PartialRemap_TIMx和GPIO_FullRemap_TIMx) 
-&gt; ClockConfig -&gt; TimeBaseInit(注意不开中断无NVIC以及注意**TIM_Period, TIM_Prescaler**) 
-&gt; TIM_OCInit -&gt; TIM_Cmd
</code></pre>
<p>Kconfig与设备树</p>
<p>$$Freq = CK_PSC/((PSC+1)*(ARR+1))$$</p>
<p>$$Duty = CCR/(ARR+1)$$</p>
<h2 id="然后是-ic">然后是 IC...</h2>
<p>AD 本身会产生大量均匀到来的中断，这对于 CPU 来说非常恶劣，<br>
因为每次进出中断都必须保护所有寄存器，频繁的中断将导致大量不必要的开销。<br>
因此，通过 DMA 在每个 AD 结果产生时自动移动到内存中，相当于空间换时间。<br>
将大量小中断集中起来统一处理，这本身就能降低 CPU 的工作量。</p>
<pre><code class="language-c">/* 输入捕获配置：决定在哪个输入边沿保存 CNT */
typedef struct
{
    uint16_t TIM_Channel;
    // 选择捕获通道 CH1～CH4，捕获结果保存在对应CCRx
	// uint16_t TIM_GetCapturek(TIM_TypeDef* TIMx);
	// void TIM_SetComparek(TIM_TypeDef* TIMx, uint16_t Comparek); // k:1-4

    uint16_t TIM_ICPolarity;
    // 捕获极性：上升沿或下降沿(检测)
	// TIM_ICPolarity_Rising, TIM_ICPolarity_Falling, TIM_ICPolarity_BothEdge

    uint16_t TIM_ICSelection;
    // 输入映射：
    // TIM_ICSelection_DirectTI   = 通道直接连接对应输入
    // TIM_ICSelection_IndirectTI = 通道交叉连接另一路输入
	// 孩子们这里是真的感觉有一点绕迷糊了 
	// 直连就是将通道1捕获的值，直接传到捕获寄存器1；交叉是将通道1的值，交叉传到捕获寄存器2。并且只能1和2交叉.3和4交叉

    uint16_t TIM_ICPrescaler;
    // 捕获边沿分频：每1、2、4或8个有效边沿捕获一次，这个相比时基单元的那个要重要一些了 
    // 注意：它不改变CNT的计数速度

    uint16_t TIM_ICFilter;
    // 输入数字滤波，0表示不滤波，0xF通常滤波最强(但是强硬件滤波会代表着高延时)

} TIM_ICInitTypeDef;
</code></pre>
<p>输入捕获: (边沿检测)上升/下降沿 看是否是对应CHx分直接/间接</p>
<p>定时器的输入捕获交叉引用（Cross-connection / Interconnection）功能，<br>
允许一个物理引脚的输入信号同时路由到多个捕获通道，或者让一个通道捕获另一个引脚的信号。</p>
<pre><code class="language-c">void TIM_ICInit(TIM_TypeDef* TIMx, TIM_ICInitTypeDef* TIM_ICInitStruct);
void TIM_PWMIConfig(TIM_TypeDef* TIMx, TIM_ICInitTypeDef* TIM_ICInitStruct);
</code></pre>
<p>感觉测频法会好一些(f高时)；测周法(f比较小时)</p>
<p>TI1FP1, TI2FP2(CH1, CH2) ??? TRGO TRGI ???<br>
不赖</p>
<p>TIxFPy:定时器Channelx的信号(CHx)，...，连接到捕获/比较通道y(和TIM_ICSelection有关)</p>
<p>每一个捕获/比较通道都是围绕着一个捕获/比较寄存器(包含影子寄存器),包括捕获的输入部分<br>
(数字滤波、多路复用和预分频器),和输出部分(比较器和输出控制)。</p>
<p>好像现在我看不懂原理但是会写代码了(x)<br>
1.捕获信号路由 2.TIxFPy TRGI TRGO</p>
<pre><code class="language-c">void TIM_SelectInputTrigger(TIM_TypeDef* TIMx, uint16_t TIM_InputTriggerSource);
void TIM_SelectOutputTrigger(TIM_TypeDef* TIMx, uint16_t TIM_TRGOSource);
void TIM_SelectSlaveMode(TIM_TypeDef* TIMx, uint16_t TIM_SlaveMode);
</code></pre>
<h2 id="手册摘录143x-捕获比较">手册摘录（14.3.x 捕获/比较）</h2>
<blockquote>
<p>// 不管了先把手册搬过来，有些地方还是写的不错的</p>
<h3 id="1434-捕获比较通道">14.3.4 捕获/比较通道</h3>
<p>每一个捕获/比较通道都是围绕着一个捕获/比较寄存器(包含影子寄存器)，包括捕获的输入部分<br>
(数字滤波、多路复用和预分频器)，和输出部分(比较器和输出控制)。<br>
下面几张图是一个捕获/比较通道概览。<br>
输入部分对相应的TIx输入信号采样，并产生一个滤波后的信号TIxF。然后，一个带极性选择的<br>
边缘检测器产生一个信号(TIxFPx)，它可以作为从模式控制器的输入触发或者作为捕获控制。该<br>
信号通过预分频进入捕获寄存器(ICxPS)。</p>
<p>捕获/比较模块由一个预装载寄存器和一个影子寄存器组成。读写过程仅操作预装载寄存器。<br>
通用定时器(TIMx)<br>
在捕获模式下，捕获发生在影子寄存器上，然后再复制到预装载寄存器中。<br>
在比较模式下，预装载寄存器的内容被复制到影子寄存器中，然后影子寄存器的内容和计数器<br>
进行比较。</p>
<h3 id="1435-输入捕获模式">14.3.5 输入捕获模式</h3>
<p>在输入捕获模式下，当检测到ICx信号上相应的边沿后，计数器的当前值被锁存到捕获/比较寄存<br>
器(TIMx_CCRx)中。当捕获事件发生时，相应的CCxIF标志(TIMx_SR寄存器)被置’1’，如果使能<br>
了中断或者DMA操作，则将产生中断或者DMA操作。如果捕获事件发生时CCxIF标志已经为<br>
高，那么重复捕获标志CCxOF(TIMx_SR寄存器)被置’1’。写CCxIF=0可清除CCxIF，或读取存<br>
储在TIMx_CCRx寄存器中的捕获数据也可清除CCxIF。写CCxOF=0可清除CCxOF。<br>
以下例子说明如何在TI1输入的上升沿时捕获计数器的值到TIMx_CCR1寄存器中，步骤如下：<br>
● 选择有效输入端：TIMx_CCR1必须连接到TI1输入，所以写入TIMx_CCR1寄存器中的<br>
CC1S=01，只要CC1S不为’00’，通道被配置为输入，并且TM1_CCR1寄存器变为只读。<br>
● 根据输入信号的特点，配置输入滤波器为所需的带宽(即输入为TIx时，输入滤波器控制位是<br>
TIMx_CCMRx寄存器中的ICxF位)。假设输入信号在最多5个内部时钟周期的时间内抖动，<br>
我们须配置滤波器的带宽长于5个时钟周期。因此我们可以(以fDTS频率)连续采样8次，以确<br>
认在TI1上一次真实的边沿变换，即在TIMx_CCMR1寄存器中写入IC1F=0011。<br>
● 选择TI1通道的有效转换边沿，在TIMx_CCER寄存器中写入CC1P=0(上升沿)。<br>
● 配置输入预分频器。在本例中，我们希望捕获发生在每一个有效的电平转换时刻，因此预<br>
分频器被禁止(写TIMx_CCMR1寄存器的IC1PS=00)。<br>
● 设置TIMx_CCER寄存器的CC1E=1，允许捕获计数器的值到捕获寄存器中。<br>
● 如果需要，通过设置TIMx_DIER寄存器中的CC1IE位允许相关中断请求，通过设置<br>
TIMx_DIER寄存器中的CC1DE位允许DMA请求。<br>
当发生一个输入捕获时：<br>
● 产生有效的电平转换时，计数器的值被传送到TIMx_CCR1寄存器。<br>
● CC1IF标志被设置(中断标志)。当发生至少2个连续的捕获时，而CC1IF未曾被清除，<br>
CC1OF也被置’1’。<br>
● 如设置了CC1IE位，则会产生一个中断。<br>
● 如设置了CC1DE位，则还会产生一个DMA请求。<br>
为了处理捕获溢出，建议在读出捕获溢出标志之前读取数据，这是为了避免丢失在读出捕获溢<br>
出标志之后和读取数据之前可能产生的捕获溢出信息。<br>
注： 设置TIMx_EGR寄存器中相应的CCxG位，可以通过软件产生输入捕获中断和/或DMA请求。</p>
<h3 id="1436-pwm输入模式">14.3.6 PWM输入模式</h3>
<p>该模式是输入捕获模式的一个特例，除下列区别外，操作与输入捕获模式相同：<br>
● 两个ICx信号被映射至同一个TIx输入。<br>
● 这2个ICx信号为边沿有效，但是极性相反。<br>
● 其中一个TIxFP信号被作为触发输入信号，而从模式控制器被配置成复位模式。<br>
例如，你需要测量输入到TI1上的PWM信号的长度(TIMx_CCR1寄存器)和占空比(TIMx_CCR2<br>
寄存器)，具体步骤如下(取决于CK_INT的频率和预分频器的值)<br>
● 选择TIMx_CCR1的有效输入：置TIMx_CCMR1寄存器的CC1S=01(选择TI1)。<br>
● 选择TI1FP1的有效极性(用来捕获数据到TIMx_CCR1中和清除计数器)：置CC1P=0(上升沿<br>
有效)。<br>
● 选择TIMx_CCR2的有效输入：置TIMx_CCMR1寄存器的CC2S=10(选择TI1)。<br>
● 选择TI1FP2的有效极性(捕获数据到TIMx_CCR2)：置CC2P=1(下降沿有效)。<br>
● 选择有效的触发输入信号：置TIMx_SMCR寄存器中的TS=101(选择TI1FP1)。</p>
<p>通用定时器(TIMx)<br>
● 配置从模式控制器为复位模式：置TIMx_SMCR中的SMS=100。<br>
● 使能捕获：置TIMx_CCER寄存器中CC1E=1且CC2E=1。</p>
</blockquote>
<p>由于只有TI1FP1和TI2FP2连到了从模式控制器，所以PWM输入模式只能使用TIMx_CH1/TIMx_CH2信号。<br>
PWMI模式和主从触发模式本身都不依赖中断，它们是定时器硬件自动完成的。<br>
CH3/CH4测PWM不依赖中断，但依赖软件作差；中断只是为了及时保存捕获结果，避免CCRx被覆盖。</p>
<p>ti1fp1是从模式的其中一个输入信号，从模式的作用是收到信号就做相应的操作，如清零cnt，<br>
如果没有这个，那就只能用中断来完成这个任务，太浪费，所以就有了这个硬件电路，通过PWMI模式来完成这些频率高且简单的任务</p>
<h2 id="信号路由oc--ic--trgo--trgi">信号路由：OC / IC / TRGO / TRGI</h2>
<p>解释:<br>
IC的PWMI模式需要TIMxCH1/CH2，其他两个不能自动计算</p>
<pre><code class="language-text">OC流程:TIMxCHy ---&gt; TIxF -&gt; TIxFPx -&gt; ICx -&gt; CCR
        (TIM_ICFilter) 
</code></pre>
<p>如果要OC -&gt; IC的话...(内部触发捕获：)</p>
<pre><code class="language-text">TIMx -&gt; TRGO -&gt; ITRm -&gt; TRGI -&gt; TIMy
(     OC    )         (      IC      )
TRGO → ITRm → TRGI/TRC → ICx
使用 TRC
</code></pre>
<p>外部引脚捕获：</p>
<pre><code class="language-text">CHx引脚 → TIx → ICx
使用 TIM_ICSelection_DirectTI
</code></pre>
<pre><code class="language-c">// 应该一般也是使用外部的emm
</code></pre>
<pre><code class="language-c">#define TIM_ICSelection_DirectTI           ((uint16_t)0x0001) /*!&lt; TIM Input 1, 2, 3 or 4 is selected to be 
                                                                   connected to IC1, IC2, IC3 or IC4, respectively */
#define TIM_ICSelection_IndirectTI         ((uint16_t)0x0002) /*!&lt; TIM Input 1, 2, 3 or 4 is selected to be
                                                                   connected to IC2, IC1, IC4 or IC3, respectively. */
</code></pre>
<pre><code class="language-c">void TIM_SelectInputTrigger(TIM_TypeDef* TIMx, uint16_t TIM_InputTriggerSource);
</code></pre>
<p>TIM_InputTriggerSource:</p>
<pre><code class="language-text">TS[2:0]：触发选择 (Trigger selection) 位6:4 
这3位选择用于同步计数器的触发输入。
000：内部触发0(ITR0)，TIM1 100：TI1的边沿检测器(TI1F_ED) 
001：内部触发1(ITR1)，TIM2 101：滤波后的定时器输入1(TI1FP1) 
010：内部触发2(ITR2)，TIM3 110：滤波后的定时器输入2(TI2FP2) 
011：内部触发3(ITR3)，TIM4 111：外部触发输入(ETRF) 
关于每个定时器中ITRx的细节，参见表78。 
注：这些位只能在未用到(如SMS=000)时被改变，以避免在改变时产生错误的边沿检测。
</code></pre>
<p>GPIO上的OC→IC用于测量真实外部波形；<br>
内部TRGO→TRGI主要用于定时器同步、级联和硬件控制，不是专门为了输入捕获。</p>
<h2 id="oc--ic-初始化流程">OC → IC 初始化流程</h2>
<p>所以。。(还要注意PWMI模式只能CH1, CH2用)</p>
<p>OC -&gt; IC(普通):</p>
<pre><code class="language-text">OC侧:RCC -&gt; GPIO_init -&gt; ClockConfig -&gt; TimeBaseInit -&gt; (无中断) -&gt; OCInit(OCMode, OCPolarity) -&gt; TIM_Cmd 
IC侧: RCC -&gt; GPIO_init -&gt; ClockConfig -&gt; TimeBaseInit -&gt; ITConfig(TIM_IT_CCx) -&gt; ICInit(ICPolarity, TIM_ICSelection) -&gt; NVIC_Init -&gt; TIM_Cmd
</code></pre>
<p>OC -&gt; IC(内部通道PWMI模式):<br>
OC侧一样，IC侧在TIM_Cmd之前要配置TRGO(-&gt; SelectInputTrigger -&gt; SelectSlaveMode )....这个就测量占空比很方便了</p>
<h2 id="纯-ic-测-duty-和-freq">纯 IC 测 Duty 和 Freq</h2>
<p>哎，仅凭我口还是不能很好的记述出来<br>
纯IC测Duty和Freq...xxx<br>
以TIM4CH3(RisingDirect, FallingIndirect)为例:<br>
那好了直接记公式好吧(TIM4为IC，所以只出现了TIM4的数据)</p>
<pre><code class="language-c">// 孩子们我不用PWMI直接用普通的IC模式测量占空比
// 我服了好像更加复杂了https://www.cnblogs.com/helesheng/p/14107012.html
// Duty = CCR/(ARR+1) -&gt; xxx
// Freq = CK_PSC/((PSC+1)*(ARR+1)) -&gt; (72MHz/TIM_GetPrescaler(TIM4))/(TIM_GetCapture4(TIM4)+1)
</code></pre>
<pre><code class="language-c">void TIM4_IRQHandler() { // IC -&gt; TIM4CH3:PB8(RisingDirect), TIM4CH4:PB9(FallingIndirect)
	// 模仿PWMI模式...不过是软件方式2333
	if (TIM_GetITStatus(TIM4, TIM_IT_CC3) == SET) {
		TIM_ClearITPendingBit(TIM4, TIM_IT_CC3);
		// TIM_GetCounter(TIM4)
		TIM4-&gt;CCR3 = TIM_GetCounter(TIM4);
		TIM4-&gt;CNT = 0;
	}
	if (TIM_GetITStatus(TIM4, TIM_IT_CC4) == SET) {
		TIM_ClearITPendingBit(TIM4, TIM_IT_CC4);
		TIM4-&gt;CCR4 = TIM_GetCounter(TIM4);
	}
}
</code></pre>
