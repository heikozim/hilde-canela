#!/usr/bin/env perl
#
# Part of Canela, a live Markdown editor in Hilde.
#
# SPDX-FileCopyrightText: 2026 Heiko Zimmermann
# SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
#
# Gives every relative module import of the Canela files in a directory a
# version (?v=<stamp>), so that a browser that cached the modules of an older
# deploy loads the new ones: a host hashes only the file it names in its page
# (start.js), never what that file imports.  Run on the copy a host serves,
# not on app/wasm.  Prints how many imports it stamped; exit 1 when none.
#
#     perl app/wasm/stamp.pl <directory> <stamp>
use strict;
use warnings;

my ($dir, $stamp) = @ARGV;
die "usage: stamp.pl <directory> <stamp>\n" unless defined $stamp && $stamp =~ /^[0-9a-zA-Z._-]{1,40}$/;
my $count = 0;
for my $name (qw(start.js canela.js html-view.js paste-clean.js icons.js)) {
	my $path = "$dir/$name";
	next unless -f $path;
	open my $in, '<:raw', $path or die "$path: $!\n";
	local $/;
	my $text = <$in>;
	close $in;
	my $n = ($text =~ s{(from\s+"\./[a-z-]+\.js)(?:\?v=[0-9a-zA-Z._-]+)?(")}{$1?v=$stamp$2}g);
	$count += $n;
	open my $out, '>:raw', $path or die "$path: $!\n";
	print $out $text;
	close $out;
	print "$name: $n\n";
}
print "stamped $count imports with $stamp\n";
exit($count > 0 ? 0 : 1);
