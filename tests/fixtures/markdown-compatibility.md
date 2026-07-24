---
title: "FluidMD Compatibility"
author: "FluidMD"
date: 2026-07-24
tags: [offline, markdown]
version: "1.0"
draft: false
---

# FluidMD Compatibility

[TOC]

[[toc]]

## Overview

### Overview

#### Details

Term
: A definition with **formatting**.

> [!NOTE] Local first
> Remote content stays blocked.

Inline math: \(a^2 + b^2 = c^2\).

\[
\int_0^1 x^2\,dx
\]

```math
E = mc^2
```

```mermaid
flowchart LR
  A[Markdown] --> B[Preview]
```

<details open>
<summary>Semantic HTML</summary>
H<sub>2</sub>O and <kbd>Ctrl</kbd> + <kbd>P</kbd>.<br>
</details>

<script>alert("blocked")</script>

Text with a footnote.[^offline]

[^offline]: Stored on disk.
