#!/bin/bash
set -e

SCRIPTPATH=$0
if [ ! -e "$SCRIPTPATH" ]; then
  case $SCRIPTPATH in
    (*/*) exit 1;;
    (*) SCRIPTPATH=$(command -v -- "$SCRIPTPATH") || exit;;
  esac
fi
dir=$(
  cd -P -- "$(dirname -- "$SCRIPTPATH")" && pwd -P
) || exit
SCRIPTPATH=$dir/$(basename -- "$SCRIPTPATH") || exit
PROJECT_HOME="$(dirname "$(dirname "$SCRIPTPATH")" )"

SOCAT_VERSION="1.8.0.1"
SOCAT_TARBALL="socat-${SOCAT_VERSION}.tar.gz"
SOCAT_PACKAGE="http://www.dest-unreach.org/socat/download/${SOCAT_TARBALL}"

mkdir -p "$PROJECT_HOME/bin"
mkdir -p "$PROJECT_HOME/temp"

if [[ ! -f "$PROJECT_HOME/temp/${SOCAT_TARBALL}" ]]; then
  echo "Downloading socat ${SOCAT_VERSION} from $SOCAT_PACKAGE"
  curl -L "$SOCAT_PACKAGE" -o "$PROJECT_HOME/temp/${SOCAT_TARBALL}"
  tar -xzf "$PROJECT_HOME/temp/${SOCAT_TARBALL}" -C "$PROJECT_HOME/temp"
fi

if [[ -f "$PROJECT_HOME/temp/socat-${SOCAT_VERSION}/socat" ]]; then
  echo "Relay binary already exists"
else
  cd "$PROJECT_HOME/temp/socat-${SOCAT_VERSION}"
  # Additional flags (if needed)
  export CC="musl-gcc"
  export LD="musl-ld"
  export CFLAGS="-O2 -Wall"
  export LDFLAGS="-static"
  export TARGET=x86_64-linux-musl
  # Static build
  ./configure \
    --prefix="$PROJECT_HOME" \
    --enable-msglevel=DEBUG \
    --disable-largefile \
    --disable-stats \
    --disable-fdnum \
    --disable-file \
    --disable-creat \
    --disable-socketpair \
    --disable-termios \
    --disable-ip4 \
    --disable-ip6 \
    --disable-rawip \
    --disable-interface \
    --disable-tcp \
    --disable-udp \
    --disable-udplite \
    --disable-sctp \
    --disable-dccp \
    --disable-vsock \
    --disable-namespaces \
    --disable-posixmq \
    --disable-socks4 \
    --disable-socks4a \
    --disable-socks5 \
    --disable-openssl \
    --disable-exec \
    --disable-system \
    --disable-shell \
    --disable-pty \
    --disable-fs \
    --disable-readline \
    --disable-tun \
    --disable-sycls \
    --disable-filan \
    --disable-libwrap \
    && echo "Configured socat with minimal features"
  echo "Building socat"
  make clean
  make socat
  strip -S socat
  chmod +x socat
fi

if [[ ! -f "$PROJECT_HOME/temp/socat-${SOCAT_VERSION}/socat" ]]; then
  echo "Relay binary not found"
  exit 1
fi

echo "Copying relay to $PROJECT_HOME/bin"
cp "$PROJECT_HOME/temp/socat-${SOCAT_VERSION}/socat" "$PROJECT_HOME/bin/container-desktop-wsl-relay"

echo "Computing relay sha256sum"
sha256sum < "$PROJECT_HOME/bin/container-desktop-wsl-relay" > "$PROJECT_HOME/bin/container-desktop-wsl-relay.sha256"
