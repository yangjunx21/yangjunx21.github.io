---
title: "Scaling Agent Swarm"
date: 2026-09-25
lang: en
published: true
excerpt: "Recent work on scaling agent swarms, and my thoughts and judgments about this direction."
source_issue: "https://github.com/yangjunx21/yangjunx21.github.io/issues/1"
---

> Junxiao Yang

One starting point for this line of work is [OpenAI's Navier–Stokes result](https://openai.com/index/navier-stokes-solution/). The exact solution process has not been disclosed, but the blog briefly describes the approach as follows:

> Agents were subdivided into groups with the ability to communicate within the group. The groups varied in size, and the group that produced the Navier–Stokes resolution involved on the order of 10,000 concurrent agents.  ... For each problem, we prompted different groups of agents with different variants of the problem statement, covering all variants of the problem. For the Navier–Stokes problem, we suggested versions “A” and “B” (particular forms of the Navier–Stokes problem which would result in a proof) and versions “C” and “D” (which would result in a disproof) to separate groups of agents. ... We encouraged different groups of agents to explore a diversity of approaches. After some time, we cross-pollinated the agent groups by using Codex to consolidate the most useful insights from each agent group. These follow-up prompts drew on the agents’ own intermediate results. The group that found the solution to Navier–Stokes was guided in such a way.

Despite the limited detail, I see two signals here. First, **diversity-guided exploration**: a large open question can be broken into several research questions, and even adversarial proposals can produce a wider range of claims to test. Second, **decentralization with organization**: scaling agents calls for moving beyond the rigid pattern of a main agent spawning subagents, which creates bottlenecks in both information flow and scheduling. At the same time, agents still need ways to organize and broadcast what they learn. I like OpenAI's term *cross-pollination*: groups can deliberately share and absorb useful ideas from one another. The resulting discovery loop is: divide into groups, consolidate findings, broadcast them, and repeat.

<img width="888" height="688" alt="Diagram of the group, consolidate, broadcast, repeat discovery loop" src="https://github.com/user-attachments/assets/831e2db8-fce0-46e7-986d-d7f30ddad69f" />

Two recent papers on agent swarms, both from Microsoft Research, are especially interesting:

- [Scaling Discovery through Test-Time Communication](https://arxiv.org/pdf/2609.21032)
- [Agensh: Scaling Organizational Intelligence to 1,024 Agents](https://arxiv.org/pdf/2609.26781)

The first paper compares Best@n with Team@n across ARC-ACI-3, Polyomino Packing, and MNIST Compression, showing gains from communication between agents. Its figure matches my intuition. On shorter, less complex tasks such as math problems and AIME, best@k can already work well: there is little time for collaboration to add value, and independent sampling can reach the ceiling. On longer and more complex tasks, however, we do not know which direction will work best. Directions may also overlap or depend on one another. In those settings, some communication—or cross-pollination—should intuitively help.

<img width="1352" height="400" alt="Best@n and Team@n comparison figure from Scaling Discovery through Test-Time Communication" src="https://github.com/user-attachments/assets/38f32dea-f336-4221-9dcf-666123eff12d" />

The implementation still uses fairly preliminary design choices, and the code has not been released yet. Here is how I understand it:

1. An agent claims a slot and begins investigating a direction. Agents that claim later slots can see the directions already chosen, so they can choose different ones.
2. Each agent writes its findings to a shared document. It can broadcast its own discoveries and read those of other agents. The agents do this proactively, without a hard-coded harness governing every interaction.
3. If an agent fails to improve the result several times in a row, it switches direction. If another direction is promising, it can recognize that result and build on the existing work.

The following diagram sketches this process. To me, it is close to an ideal way for a small agent swarm to collaborate.

<img width="1448" height="1086" alt="Small agent swarm collaboration workflow" src="https://github.com/user-attachments/assets/ff87e8a8-3029-45ff-92f9-f84415784161" />

The second paper scales to a much larger number of agents. Its underlying idea is similar: decentralized organization.

<img width="1118" height="528" alt="Figure illustrating the larger agent organization in Agensh" src="https://github.com/user-attachments/assets/99f4fe82-8b5c-43bc-a4e9-085c732daa07" />

<img width="660" height="454" alt="Additional figure from Agensh" src="https://github.com/user-attachments/assets/09151a8b-0b06-4b75-b376-3bba45fcc78c" />

The figures and explanations in this paper are intuitive and easy to follow, and its early results and demo are interesting. Still, I have two questions that I want to revisit when the code is released. First, where do the gains from scaling the agent swarm actually come from? I do not think program bench is an especially suitable setting for this kind of scaling: it seems more like development work than an open-ended exploration problem. I discussed with the authors whether a pass@n comparison would be appropriate. To me, that remains an open question, and I lean toward requiring evidence that communication between agents is what matters.

Second, I am skeptical that simple infrastructure can support meaningful decentralized communication among 1,024 agents. The two papers use broadly similar approaches. My intuition is that this design's capacity for handling information may not scale much beyond about 32 agents; above that, it is hard to see how the same mechanism could sustain useful exchange. That is a hypothesis, though, and I would need to run experiments and study the source code before drawing a firmer conclusion.

Overall, scaling agent swarms is an interesting topic and a new scaling dimension. I see two key starting points: **diverse, decentralized exploration across multiple directions**, and **free, proactive information sharing through shared files**. Personally, I would also keep task constraints as light as possible and the search space as broad as possible. Otherwise, there is little point in studying the scaling of an agent swarm. There are many open questions here, and I look forward to more papers and reports.
