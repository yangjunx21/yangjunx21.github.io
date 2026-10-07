---
title: "Multi-Agent Systems, Then and Now: Do We Still Need Them?"
date: 2026-10-07
lang: en
published: true
excerpt: "Why We Need MAS: Decomposition, Context Management and Exploration-Maxxing"
tags:
  - "multi-agent system"
source_issue: "https://github.com/yangjunx21/yangjunx21.github.io/issues/2"
---

My [last post](https://yangjunx21.github.io/blog/2026/09/25/scaling-agent-swarm-en/) covered a few recent papers on agent swarms. Since writing it, I keep coming back to a more basic question: why do we need multi-agent systems at all, and why study them? The field has gone from ChatDev, MetaGPT and the Stanford "Smallville" agents in 2023, to last year's "Don't Build Multi-Agents", to OpenAI putting on the order of ten thousand agents on Navier–Stokes this year. As models keep getting stronger and the tasks keep getting harder, I think the answer to that question has kept changing.

Broadly, the case for MAS has gone through three versions. Each one starts from a different motivation, and each treats something different as the unit of "one agent":

1. Division of labor: the original idea of organizing LLMs like a team, where an agent is a specific role.
2. Context: handing parts of a long task to subagents, where an agent is a clean context window.
3. Exploration: the space of work and directions to explore is simply too large, so an agent is one long-running trajectory on its own piece of the problem.

The first idea, role-based division of labor, has largely been absorbed by rapidly improving base models. Context management has recently become accepted practice, with a large body of work behind it, and is maturing. Exploration is the interesting new frontier: here we are purely scaling the number of agents. The analogy I have in mind is parameter scaling in LLMs. Some capabilities only emerge past a certain model size, and the hope is that as we increase the number of collaborating agents, they can solve problems that no single base model can.

## 1. Division of Labor: The Original Org-Chart Idea

The first wave of MAS work followed a very direct line of reasoning: humans tackle complex work through organization and division of labor, so let LLMs play different roles too.

- [CAMEL](https://arxiv.org/abs/2303.17760) used role-playing to build complex multi-agent simulations;
- [Generative Agents](https://arxiv.org/abs/2304.03442) put 25 agents with memory, reflection and planning into Smallville. It is social simulation rather than problem-solving, but this is roughly where the idea of an "agent society" began;
- [ChatDev](https://arxiv.org/abs/2307.07924) went as far as setting up a virtual software company, where a CEO, CTO, programmer, reviewer and tester talk in pairs, following a waterfall process;
- [MetaGPT](https://arxiv.org/abs/2308.00352) took this a step further by encoding SOPs as sequences of prompts. What passes between roles is not chit-chat but structured artifacts such as PRDs and interface specs;
- [AutoGen](https://arxiv.org/abs/2308.08155) abstracted all of this into programmable conversations between agents;
- [Multiagent Debate](https://arxiv.org/abs/2305.14325) dropped roles altogether: several copies of the same model read each other's answers, debate, and revise.

![ChatDev: a virtual software company where a CEO, CTO, programmer, reviewer and tester talk in pairs along a waterfall process](https://github.com/user-attachments/assets/3bea4c9f-d124-48d9-9754-883e368e207a "ChatDev: a virtual software company where a CEO, CTO, programmer, reviewer and tester talk in pairs along a waterfall process")

The implicit assumption of this phase was that a single model isn't good enough, and that splitting the work into roles, each with its own responsibilities, would raise quality. Looking back, the assumption has a fundamental flaw: every role is the same model. The only difference between the "CTO" and the "programmer" is the system prompt. The division of labor is a prompt-level bias, not a difference in capability.

Several later papers showed, from different angles, that this kind of prompt-defined division of labor buys little in practice:

1. [More Agents Is All You Need](https://arxiv.org/abs/2402.05120) found that no elaborate framework is needed: sample the same model N times and take a majority vote, and performance climbs with the number of agents. With 15 voting agents, Llama2-13B matches a single Llama2-70B;
2. [Debate or Vote](https://arxiv.org/abs/2508.17536) separated debate into its voting and discussion components, found that most of the gain comes from majority voting, and proved that debate by itself does not raise expected accuracy;
3. [Rethinking the Bounds of LLM Reasoning](https://arxiv.org/abs/2402.18272) found that a single agent given one good demonstration in its prompt (75.63) does about as well as the best multi-agent discussion framework (74.46).

![Plain sampling plus voting already improves with the number of agents (More Agents Is All You Need, Figure 1)](https://arxiv.org/html/2402.05120v2/intro_finding_rebuttal.svg "Plain sampling plus voting already improves with the number of agents (More Agents Is All You Need, Figure 1)")

The most convincing evidence comes from Berkeley's [MAST](https://arxiv.org/abs/2503.13657) (Why Do Multi-Agent LLM Systems Fail?). The authors analyzed more than 1,600 traces from seven open-source MAS, including ChatDev and MetaGPT, and found failure rates between 41% and 86.7%. They distilled 14 failure modes that fall into three groups: system design, misalignment between agents, and missing verification. One telling number: failing to follow the role specification accounts for only 1.5% of failures. The problem was never that agents couldn't play their parts. It was the problems that collaboration itself introduces: repeating steps, not knowing when to stop, reasoning that doesn't match the actions taken. Adding a high-level verification step to ChatDev improved results by 15.6%, more than writing clearer role specifications (+9.4%).

![MAS fail in 14 ways, clustered into system design, inter-agent misalignment and task verification (MAST, Figure 1)](https://arxiv.org/html/2503.13657v3/taxonomy_neurips_final_10_23_25.svg "MAS fail in 14 ways, clustered into system design, inter-agent misalignment and task verification (MAST, Figure 1)")

As an aside, [MacNet](https://arxiv.org/abs/2406.07155) had already pushed the number of agents into the thousands during this period and proposed a collaborative scaling law: performance grows logistically with the number of agents and mostly saturates at around 100. It was arguably the first attempt to treat agent count as a scaling dimension, but within the division-of-labor framing the gains plateaued quickly.

This was an early stage in the development of MAS, and division of labor is not what MAS is fundamentally about. Role-play added no new information or capability. Much of the gain came from simply sampling more times, while free-form conversation introduced new ways to fail. What survived were a few things: structured hand-offs (MetaGPT's documents), executable feedback, and verification. Once models got stronger and a single agent with tools became good enough, the "virtual company" style of MAS largely faded away.

## 2. Context: Everything for a Clean Context Window

In 2025, MAS came back into favor, but for an entirely different reason: keeping the context clean.

On long-horizon tasks, the real bottleneck for a single agent is that its context keeps getting messier. The evidence goes back a while. [Lost in the Middle](https://arxiv.org/abs/2307.03172) showed that performance drops markedly when the relevant information sits in the middle of a long context; in the worst case it fell below the closed-book baseline, where the model gets no documents at all (56.1%). Chroma's [Context Rot](https://www.trychroma.com/research/context-rot) report tested 18 models and was more blunt: for the same question, giving the model only the relevant ~300 tokens (focused) works far better than giving it the full ~113k tokens (full). On multi-session questions, for example, Claude Opus 4 scored 0.92 with the focused prompt and just 0.36 with the full one. Having the information in context doesn't mean the model can use it.

![On the same questions, a focused context clearly beats the full context (Chroma, Context Rot)](https://www.trychroma.com/img/context_rot/longmemeval/claude_comparison.png "On the same questions, a focused context clearly beats the full context (Chroma, Context Rot)")

So MAS became a way to manage context. The most representative example is Anthropic's [multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system): a lead agent plans the research and spins up 3–5 subagents in parallel, each searching within its own context window and handing back only a compressed result. Some of their findings at the time:

1. With Opus 4 as the lead and Sonnet 4 as subagents, the system beat single-agent Opus 4 by 90.2% on an internal research eval;
2. On BrowseComp, token usage alone explained 80% of the variance in performance (95% together with the number of tool calls and the choice of model);
3. The cost: the multi-agent system used roughly 15 times as many tokens as a regular chat.

As the post puts it: "The essence of search is compression."

![A lead agent orchestrates several search subagents in parallel, each with its own context (Anthropic, How we built our multi-agent research system)](https://www-cdn.anthropic.com/images/4zrzovbb/website/1198befc0b33726c45692ac40f764022f4de1bf2-4584x2579.png "A lead agent orchestrates several search subagents in parallel, each with its own context (Anthropic, How we built our multi-agent research system)")

To me, point 2 is the heart of this phase: MAS is essentially a way to spend tokens. When a single context window can't hold that many tokens, or can't make good use of them, you split the work across several clean windows that spend them in parallel, then compress the results back. Anthropic's later post on [context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) makes this explicit: a subagent may use tens of thousands of tokens exploring, but returns only a 1,000–2,000-token summary.

This phase also drew strong pushback. Cognition's [Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) laid out two principles: share the full trace, not just individual messages; and "Actions carry implicit decisions." Every subagent's actions embed decisions, and when those decisions conflict, the result breaks. (Their example is a Flappy Bird clone where one subagent draws a Mario-style background and another draws a bird in a completely mismatched style.) Google's [Towards a Science of Scaling Agent Systems](https://arxiv.org/abs/2512.08296) ran controlled experiments that held tools, prompts and compute fixed, comparing a single agent against several multi-agent architectures:

1. Decomposable tasks gain a lot: a centralized MAS improves financial analysis by 80.8%;
2. Tasks with strong sequential dependencies get worse across the board: every MAS variant drops 39% to 70% on PlanCraft;
3. Independent agents amplify errors 17.2×, and even with centralized verification the factor is still 4.4×;
4. Once single-agent accuracy passes roughly 45%, adding agents has negative returns.

![Change relative to a single agent: large gains on parallelizable tasks, consistent losses on sequential ones (Towards a Science of Scaling Agent Systems, Figure 2)](https://arxiv.org/html/2512.08296v3/boxplots_v4.png "Change relative to a single agent: large gains on parallelizable tasks, consistent losses on sequential ones (Towards a Science of Scaling Agent Systems, Figure 2)")

By this year, the field has largely converged on a compromise: reads can run in parallel, but writes stay single-threaded. Even Cognition's own April post, [Multi-Agents: What's Actually Working](https://cognition.ai/blog/multi-agents-working), concedes that this works: multiple agents contribute intelligence while writes stay on one thread. One example is a review agent with a clean context looking at the code. Because it doesn't inherit the context of the coding session, it is actually sharper.

![The coding agent carries an ever-growing context; the review agent sees only the code (Cognition, Multi-Agents: What's Actually Working)](https://cdn.sanity.io/images/2mc9cv2v/production/139c3cd1b93e3d9e0c69cf07c8a474c7ff0c1031-768x593.png "The coding agent carries an ever-growing context; the review agent sees only the code (Cognition, Multi-Agents: What's Actually Working)")

Two other lines of work show that orchestration itself is becoming something learned. [Recursive Language Models](https://arxiv.org/abs/2512.24601) treat an extremely long prompt as a variable in a REPL and let the model write code to slice it up and call itself recursively. Kimi K2.5's [Agent Swarm](https://www.kimi.com/en/blog/kimi-k2-5) uses PARL to train the orchestrator directly with RL, so that it learns to split up tasks and spin up as many as 100 subagents; on BrowseComp it goes from 60.6 as a single agent to 78.4.

![A trainable orchestrator creates subagents and assigns them tasks on the fly (Kimi K2.5 Agent Swarm)](https://statics.kimi.ai/blogs/k2-5/orchestrator-1.png "A trainable orchestrator creates subagents and assigns them tasks on the fly (Kimi K2.5 Agent Swarm)")

So in this phase, the unit of an agent is a context window, and MAS = context management + parallelism. It genuinely works, but this approach is mostly about breaking a workflow into pieces: the task boundary is clear, the orchestrator knows how to decompose it, and subagents gather information for a single main thread. The problem space itself hasn't grown.

## 3. Swarms: When the Space of Work and Exploration Is Huge

In this phase, the central tension, and the thing worth optimizing, moves from the agent to the task. The question is no longer how an agent manages its context or orchestrates a given task better. The problem itself contains a great many things that need to be done in parallel, some related and some not, and the question becomes how to explore it efficiently.

Scientific discovery and open problems are exactly this kind of situation. There is a huge number of possible directions, most of them dead ends; good results are extremely long-tailed; and at the outset nobody knows which path is right. Even with unlimited context and perfect orchestration, a single agent is still walking just one path through an enormous search tree. What MAS has to address in this phase is not that one model isn't good enough, nor merely that one context window can't hold everything, but that the space of work and exploration is itself too large. We need to "scale single intelligence for higher intelligence."

There is also a more concrete way to see why this matters. Suppose a task goes through $$T$$ stages, and a single agent succeeds at stage $$t$$ with probability $$p_t$$. With $$k$$ independent agents that don't communicate, at least one of them has to make it through every stage on its own:

$$
P_{\text{best@}k} = 1 - \left(1 - \prod_{t=1}^{T} p_t\right)^{k}
$$

If verified progress can be shared at each stage, then each stage only needs one of the $$k$$ agents to succeed, and everyone else can build on that result:

$$
P_{\text{team@}k} = \prod_{t=1}^{T} \left(1 - (1 - p_t)^{k}\right)
$$

As $$T$$ grows, the $$\prod_t p_t$$ term in the first expression shrinks exponentially, and no amount of independent sampling can make up for it. In the second, as long as $$k$$ is large enough, every factor approaches 1. This also explains why best@k is enough for short tasks (math problems, AIME), while communication only starts to pay off on long-horizon, open-ended tasks.

Interestingly, "roles" come back here, but in the opposite direction from the first phase: not a CEO and CTO hard-coded from the start, but roles that emerge on their own for the sake of collaboration as the system grows.

Several large-scale engineering efforts point to the same thing, and to its limits:

1. Anthropic had 16 Claude instances write a [C compiler](https://www.anthropic.com/engineering/building-c-compiler) in parallel. About 2,000 sessions and under $20,000 produced a 100,000-line Rust compiler that can build Linux 6.9. The coordination was very simple: a shared git repo, a file written to claim a task, and tests as the oracle. The most interesting lesson is that compiling the kernel was "one giant task": all 16 agents hit the same bug and kept overwriting each other's fixes. The fix was to use GCC as a known-good oracle and have each agent compile only part of the kernel with its own compiler, carving one big task back into small ones that could run in parallel.
2. In Cursor's [Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents), hundreds of agents spent nearly a week writing a browser of more than a million lines. They first tried flat self-coordination with locks, and 20 agents ended up with the effective throughput of two or three. It only started working after they switched to a hierarchy: planners recursively break down tasks, workers put their heads down and execute, and a judge decides whether to keep going. In their words, the right amount of structure is "somewhere in the middle."
3. In the August post from Anthropic's Frontier Red Team, [Patterns and problems in emerging multiagent systems](https://www.anthropic.com/research/multiagent-systems), a swarm of 45 agents found 266 vulnerabilities across 15 open-source projects, versus 21 for independent agents, with only 12 in common. But they also saw the swarm's weaknesses: 18 of 30 agents chose the same branch name, more than half built the same kind of project, and the more agents there were, the smaller the share of PRs that got merged.

![Cumulative vulnerabilities found by a swarm versus independent agents (Anthropic, Patterns and problems in emerging multiagent systems)](https://www-cdn.anthropic.com/images/4zrzovbb/website/5a5c187a6c2b5ccb492bcb7883df2066d49625de-2000x1200.png "Cumulative vulnerabilities found by a swarm versus independent agents (Anthropic, Patterns and problems in emerging multiagent systems)")

It is also worth staying sober about efficiency. Toby Ord's [Swarm Scaling](https://www.tobyord.com/writing/swarm-scaling) estimates, from the charts in OpenAI's GPT-5.6 launch, that $$N$$ agents running in parallel are roughly equivalent to one agent working $$N^{\lambda}$$ times as long, with $$\lambda$$ around 0.5 to 0.7 depending on the benchmark. In other words, ten times the agents is worth only about three to five times the single-agent tokens. This is a secondhand analysis, but it points the same way as Google's results: swarms don't save tokens. What they buy is speed, and a ceiling that a single agent simply can't reach.

All in all, from where we stand in October 2026, the reason we need MAS in the form of agent swarms is not that one model can't handle some subtask (the premise of the first phase has largely been overturned), nor only that one context window can't hold everything (the second phase is real, but it is closer to engineering-level context management). The fundamental reason is that for many genuinely valuable problems, the space of work and exploration exceeds what any single trajectory can cover in a limited amount of time. At that point, the number of concurrent trajectories, together with their ability to share verified progress, becomes a new scaling dimension, much like parameters and data.

Based on the evidence so far, swarms pay off under roughly three conditions:

1. The task is wide and open enough: it can be split into many directions, without strong sequential dependencies between them;
2. There is a cheap, reliable verifier (an evaluator, tests, Lean, a known-good oracle) to filter results and make sure that what gets shared is verified progress;
3. Each agent has enough budget: when compute per agent is low, independent sampling is actually the better deal.

When these conditions don't hold, a single agent plus a few subagents for reading and review is very likely the better choice.
