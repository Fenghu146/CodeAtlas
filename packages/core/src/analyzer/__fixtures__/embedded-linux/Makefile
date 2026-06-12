# SPDX-License-Identifier: GPL-2.0
#
# Makefile for the foo driver
#

obj-$(CONFIG_FOO_DRIVER) += foo-core.o
obj-m += bar-module.o
foo-core-y := foo-main.o foo-utils.o

ccflags-y += -DDEBUG -Iinclude

subdir-y += drivers/misc
