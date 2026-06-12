// SPDX-License-Identifier: GPL-2.0
/*
 * Foo Platform Driver
 */

#include <linux/module.h>
#include <linux/platform_device.h>
#include <linux/of.h>
#include <linux/sysfs.h>
#include <linux/fs.h>
#include <linux/miscdevice.h>
#include <linux/uaccess.h>
#include <linux/debugfs.h>

#define DRIVER_NAME "foo-driver"

static int foo_probe(struct platform_device *pdev)
{
	return 0;
}

static int foo_remove(struct platform_device *pdev)
{
	return 0;
}

static long foo_ioctl(struct file *filp, unsigned int cmd, unsigned long arg)
{
	return 0;
}

static ssize_t foo_value_show(struct device *dev,
			      struct device_attribute *attr, char *buf)
{
	return 0;
}
static DEVICE_ATTR_RO(foo_value);

static const struct file_operations foo_fops = {
	.owner		= THIS_MODULE,
	.unlocked_ioctl	= foo_ioctl,
};

static const struct of_device_id foo_of_match[] = {
	{ .compatible = "vendor,foo-uart", },
	{ .compatible = "vendor,foo-i2c", },
	{},
};
MODULE_DEVICE_TABLE(of, foo_of_match);

static struct platform_driver foo_driver = {
	.probe	= foo_probe,
	.remove	= foo_remove,
	.driver	= {
		.name	= DRIVER_NAME,
		.of_match_table	= foo_of_match,
	},
};

module_platform_driver(foo_driver);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("Foo Author");
MODULE_DESCRIPTION("Foo Platform Driver");
MODULE_ALIAS("platform:foo-driver");
module_param(debug_mode, int, 0644);
