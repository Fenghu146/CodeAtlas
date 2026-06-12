SUMMARY = "Foo service recipe"
LICENSE = "GPL-2.0-only"
SRC_URI = "file://foo-service.c file://foo-service.service"

DEPENDS = "libfoo libbar"
RDEPENDS:${PN} = "libfoo-runtime"

inherit systemd autotools

SYSTEMD_SERVICE:${PN} = "foo-service.service"
