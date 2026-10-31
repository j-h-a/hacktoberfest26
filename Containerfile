# To use this containerfile:
#
# Comment out or remove any of the RUN commands that you don't need.
# In the commands below, replace <image-tag>, <container-name>, <home-volume-name>, and /path/to/project
#
# 1. Create an image:
# podman build -t <image-tag> --no-cache --pull=newer --log-level=debug -f Containerfile
#
# 2. Create a container:
# podman create --name <container-name> -v /path/to/project:/workspace -v <home-volume-name>:/root <image-tag>
#
# 3. Start the container:
# podman start <container-name>
#
# 4. Now you can attach VS code to the running container and open `/workspace` and/or create shells in the running container:
# podman exec -it --env TERM=$TERM <container-name> zsh

FROM debian:trixie-slim

ENV HOME="/root"

ARG DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    ca-certificates \
    unzip \
    vim \
    tree \
    procps \
    tini \
    jq \
    bc \
    python3 \
    zsh \
    && rm -rf /var/lib/apt/lists/*

# Install oh-my-zsh and plugins
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended && \
    git clone https://github.com/zsh-users/zsh-autosuggestions ${HOME}/.oh-my-zsh/custom/plugins/zsh-autosuggestions && \
    git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${HOME}/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting && \
    git clone https://github.com/zsh-users/zsh-completions ${HOME}/.oh-my-zsh/custom/plugins/zsh-completions && \
    sed -i 's/plugins=(git)/plugins=(git zsh-autosuggestions zsh-syntax-highlighting zsh-completions)/' ${HOME}/.zshrc && \
    echo "autoload -U compinit && compinit" >> ${HOME}/.zshrc

# Install Claude Code
ENV DEVCONTAINER=true
ENV PATH="${HOME}/.local/bin:${PATH}"
RUN curl -fsSL https://claude.ai/install.sh | bash && \
    echo 'export PATH="${HOME}/.local/bin:${PATH}"' >> ${HOME}/.zshrc

# Install Node.js 24 LTS via NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm (it switches to the version pinned in the root package.json;
# its install script links the native binary)
# RUN npm install -g --allow-scripts=pnpm pnpm

# Install Deno (for Supabase Edge Functions)
#RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/opt/deno sh
#ENV PATH="/opt/deno/bin:${PATH}"

# Install Supabase CLI at its latest release, never pinned (containers should also regularly update it)
#RUN SB_ARCH="linux_$(dpkg --print-architecture)" && \
#    curl -fsSL "https://github.com/supabase/cli/releases/latest/download/supabase_${SB_ARCH}.tar.gz" | \
#    tar xz -C /usr/local/bin supabase

# Set working directory to workspace (will be mounted from host)
RUN mkdir -p /workspace
WORKDIR /workspace

# Set the default editor
ENV EDITOR=vim
ENV VISUAL=vim

# tini runs as PID 1: it reaps orphaned processes (otherwise they stay zombies until the
# container stops) and passes signals to its child, so `podman stop` works with SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]

# Container does nothing on start - exec in to use it
CMD ["sleep", "infinity"]
